/**
 * GeminiClient (Phase 7 §H) — the production GenAIClient over the Gemini
 * REST API, routed through `NetworkGateway.egress('gemini', …)`.
 *
 * Design points (each reversing a verified finding):
 *  - Config read PER CALL from the injected provider (GG-8: no mutable
 *    singleton fields — the TTS pipeline's hardcoded configure() clobber is
 *    structurally impossible).
 *  - REST instead of the deprecated @google/generative-ai SDK (the SDK
 *    accepts no fetch injection, so it could not route through the gateway;
 *    request/response shapes are SDK-identical — D14's migration note).
 *  - Rotation keeps the 429 retry with ONE models constant and a
 *    Fisher-Yates shuffle (GG-15's biased sort dies).
 *  - `validate` is applied to every structured response (GG-5); failures
 *    throw GENAI_INVALID_RESPONSE.
 *  - Logs are redacted (inlineData → {byteCount, hash}) BEFORE they reach
 *    the injected sink (privacy D3).
 *  - EVERY terminal outcome is logged: a request entry is always followed by
 *    a response entry or an error entry carrying the failure's code, HTTP
 *    status and quota context (the Jul–Sep 2026 export showed 26% of
 *    detection requests with no logged outcome — non-429 HTTP errors,
 *    rotation-off 429s and pre-network refusals all used to throw silently).
 *    Response entries also carry the serving model, latency and the API's
 *    token usage so an export can be evaluated offline.
 */
import { egress, retryAfterMs, type EgressFn } from '@kernel/net';
import { msUntilNextPtDay, type QuotaGovernor } from '@kernel/quota';
import {
  GenAIHttpError,
  GenAIInvalidResponseError,
  GenAINotConfiguredError,
  describeGenAIFailure,
  isModelUnavailable,
  isRetryableForRotation,
} from './errors';
import { redactPayload, type GenAILogEntry, type GenAILogSink } from './logging';
import { parseQuotaSignals } from './quotaSignals';
import type {
  GenAIClient,
  GenAIConfigProvider,
  GenAIPrompt,
  GenAIRequest,
  GenAIRequestContext,
} from './contract';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * The free-tier rotation list, iterated IN ORDER (no shuffle). Each entry has
 * its own daily bucket that resets at midnight PT, and the loop falls through to
 * the next entry whenever one is spent, so the day's ceiling is the SUM of the
 * buckets — 1,100 requests — REGARDLESS of order. Ordering does not add or lose
 * quota; nothing is ever stranded, because a request that cannot be admitted at
 * position N simply continues to N+1.
 *
 * What the order does decide is (a) which model serves the bulk of the day and
 * (b) how much of the chain a hard failure takes down with it. Hence:
 *
 *  1-2. The two stable 20-RPD frontier models, newest first. There is no
 *       per-call-type routing, so scarce premium quota cannot be RESERVED for
 *       high-value calls — it is spent on whatever arrives first or it expires
 *       at midnight. Leading with them at least guarantees it is spent.
 *  3-4. The two stable 500-RPD lite models: the workhorses that serve ~91% of
 *       the day.
 *  5-7. Preview and deprecating models LAST. Google retires models on its own
 *       schedule, and a retired model answers 404, not 429. Rotation now treats
 *       that as continuable (see isModelUnavailable), but keeping anything with
 *       a shutdown date below the workhorses means even a failure mode the
 *       predicate does NOT cover costs only the last 60 requests of the day
 *       instead of the first 1,040.
 *
 * The per-model 429 cooldown is recorded against that model's OWN rate pool
 * (see `recordCooldown(..., modelId)` below), so exhausting one model never
 * backpressures its siblings — the loop really does reach the next bucket.
 *
 * Gemma 4 is deliberately excluded despite its enormous 14.4K RPD: at 16K TPM
 * it cannot carry this app's book-text prompts, and it has no inline-image
 * input for table adaptation.
 */
export const GENAI_ROTATION_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
] as const;


function generateLogId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `log_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

/** The API's per-response token accounting (`usageMetadata`), as logged. */
export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiResponseBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: GeminiUsage;
  error?: { code?: number; message?: string; status?: string };
}

/**
 * The slice of the AI-API rate limiter this client touches. A `Pick` keeps the
 * dependency minimal and the seam easy to fake in tests. The limiter's
 * pre-flight admission check (reserve quota before the request) and its
 * failure-path refund are enforced one layer down at the network chokepoint,
 * where they cannot be bypassed; this client is left with only the two steps
 * that need the parsed response body the network layer never reads — `commit`
 * (record the actual tokens spent) and `recordCooldown` (start a back-off after
 * a 429 rate-limit reply). Retrying with a different model on a 429 stays in
 * {@link GeminiClient.executeWithRetry}, so the limiter never owns retries.
 */
export type GenAIQuotaGovernor = Pick<QuotaGovernor, 'commit' | 'recordCooldown'>;

/**
 * A coarse up-front token estimate so the rate limiter can reserve quota
 * before the request goes out; the actual cost is reconciled afterward from
 * the response's usage report. Uses the usual ~4-characters-per-token
 * heuristic over the serialized prompt.
 */
function estTokens(prompt: GenAIPrompt): number {
  const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt.contents);
  return Math.ceil(text.length / 4);
}

/** Default cooldown when a 429 carries no usable `Retry-After` header or RetryInfo. */
const DEFAULT_COOLDOWN_MS = 30_000;

export interface GeminiClientDeps {
  getConfig: GenAIConfigProvider;
  /** Injected for tests; production uses the kernel gateway. */
  egress?: EgressFn;
  /** Activity-log sink (entries arrive pre-redacted). */
  onLog?: GenAILogSink;
  /**
   * The AI-API rate/spend limiter. Optional: when absent the client behaves
   * exactly as before, with no quota accounting (the rotation tests construct
   * it without one).
   */
  governor?: GenAIQuotaGovernor;
  /** Wall clock (injected for tests). */
  now?: () => number;
}

/** Copy the usage fields the log records (drops anything the API adds later). */
function pickUsage(usage: GeminiUsage | undefined): GeminiUsage | undefined {
  if (!usage) return undefined;
  const out: GeminiUsage = {};
  if (typeof usage.promptTokenCount === 'number') out.promptTokenCount = usage.promptTokenCount;
  if (typeof usage.candidatesTokenCount === 'number') out.candidatesTokenCount = usage.candidatesTokenCount;
  if (typeof usage.thoughtsTokenCount === 'number') out.thoughtsTokenCount = usage.thoughtsTokenCount;
  if (typeof usage.totalTokenCount === 'number') out.totalTokenCount = usage.totalTokenCount;
  return out;
}

export class GeminiClient implements GenAIClient {
  /**
   * Errors that already produced their own 'error' log entry (JSON parse and
   * validation failures log the raw response text at the failure site), so
   * the terminal-failure logger in {@link executeWithRetry} does not record
   * the same failure twice.
   */
  private readonly alreadyLogged = new WeakSet<object>();

  constructor(private readonly deps: GeminiClientDeps) {}

  private get egress(): EgressFn {
    return this.deps.egress ?? egress;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  isConfigured(): boolean {
    return this.deps.getConfig().apiKey !== '';
  }

  private log(
    type: GenAILogEntry['type'],
    method: string,
    payload: unknown,
    context?: GenAIRequestContext,
  ): void {
    this.deps.onLog?.({
      id: generateLogId(),
      timestamp: Date.now(),
      type,
      method,
      payload: redactPayload(payload),
      bookTitle: context?.bookTitle,
      sectionTitle: context?.sectionTitle,
      correlationId: context?.correlationId,
    });
  }

  private markLogged(error: unknown): void {
    if (typeof error === 'object' && error !== null) this.alreadyLogged.add(error);
  }

  /**
   * Record the outcome of a request that will NOT be retried. A caller-driven
   * abort is expected chatter (the user navigated away) and goes to 'debug';
   * everything else is an outcome a human should be able to find in the log.
   */
  private logTerminalFailure(
    method: string,
    modelId: string,
    error: unknown,
    context: GenAIRequestContext | undefined,
    message: string,
  ): void {
    if (typeof error === 'object' && error !== null && this.alreadyLogged.has(error)) return;
    const failure = describeGenAIFailure(error);
    this.log(failure.aborted ? 'debug' : 'error', method, { message, model: modelId, ...failure }, context);
  }

  /** Model list per call: rotation shuffles the constant; else the config model. */
  private modelsToTry(): string[] {
    const config = this.deps.getConfig();
    return config.rotationEnabled
      ? [...GENAI_ROTATION_MODELS]
      : [config.model];
  }

  private async executeWithRetry<T>(
    operation: (modelId: string) => Promise<T>,
    method: string,
    context?: GenAIRequestContext,
  ): Promise<T> {
    if (!this.isConfigured()) {
      const error = new GenAINotConfiguredError();
      this.log('error', method, { message: error.message }, context);
      throw error;
    }

    const rotationEnabled = this.deps.getConfig().rotationEnabled;
    const models = this.modelsToTry();
    let lastError: unknown = null;
    for (const modelId of models) {
      try {
        return await operation(modelId);
      } catch (error) {
        lastError = error;
        // Rotate on a server 429 OR a pre-network NET_RATE_LIMITED cooldown (a
        // sibling model's 429 set the governor cooldown, so this model's gateway
        // acquire backpressured before the network) — both leave the remaining
        // models worth trying.
        if (rotationEnabled && isRetryableForRotation(error)) {
          // A retired/ungated model is ACTIONABLE — the rotation list needs
          // editing — so it stays at 'error'. Stepping over a model that is
          // merely out of quota is the expected steady state once the head of
          // the list is spent for the day, and at ~5 entries per request it
          // would evict everything worth reading from the capped ring buffer;
          // that goes to 'debug'.
          const unusable = isModelUnavailable(error);
          this.log(
            unusable ? 'error' : 'debug',
            method,
            {
              message: unusable
                ? `Model ${modelId} is unavailable (retired or not enabled for this key). Retrying with next model...`
                : `Model ${modelId} out of quota (429 / cooldown backpressure). Retrying with next model...`,
              model: modelId,
              ...describeGenAIFailure(error),
            },
            context,
          );
          continue;
        }
        this.logTerminalFailure(method, modelId, error, context, 'Request failed');
        throw error;
      }
    }
    this.logTerminalFailure(
      method,
      models[models.length - 1],
      lastError,
      context,
      `All ${models.length} rotation models failed`,
    );
    throw lastError;
  }

  private async callGemini(
    modelId: string,
    prompt: GenAIPrompt,
    generationConfig: Record<string, unknown> | undefined,
    context: GenAIRequestContext | undefined,
    signal: AbortSignal | undefined,
  ): Promise<{ text: string; usage?: GeminiUsage }> {
    const config = this.deps.getConfig();
    const contents =
      typeof prompt === 'string'
        ? [{ role: 'user', parts: [{ text: prompt }] }]
        : prompt.contents;

    // Rate-limit admission lives one layer down at the network chokepoint: the
    // network layer reserves quota (by lane + token estimate) before the call
    // goes out and refunds it on failure, so it cannot be bypassed. This client
    // just declares its lane and estimate via the egress options and handles the
    // two steps that need the parsed response body — recording the real token
    // cost (commit) and starting a back-off on a 429. Model-rotation retries
    // stay in executeWithRetry.
    const estimate = estTokens(prompt);
    let committed = false;
    const commit = (tokens: number): void => {
      if (committed) return;
      committed = true;
      this.deps.governor?.commit('fg', tokens, modelId);
    };

    const response = await this.egress(
      'gemini',
      `${GEMINI_API_BASE}/models/${modelId}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify({
          contents,
          ...(generationConfig ? { generationConfig } : {}),
        }),
      },
      {
        signal,
        consent: { bookId: context?.bookId, interactive: context?.interactive },
        lane: 'fg',
        estTokens: estimate,
        ratePool: modelId,
      },
    );

    if (!response.ok) {
      const body = (await response
        .json()
        .catch(() => ({}))) as GeminiResponseBody;
      // Feed a 429 to the governor as a cooldown signal, then RE-THROW so
      // executeWithRetry's rotation path still sees it (the governor never
      // swallows the error the rotation loop branches on). The cooldown is
      // the server's own hint (Retry-After header, else the RetryInfo detail
      // or the "retry in Ns" message text); a DAILY quota exhaustion cools
      // the pool down until the next Pacific day — re-sending before then can
      // only collect another 429.
      let quotaContext: Record<string, unknown> = {};
      if (response.status === 429) {
        const signals = parseQuotaSignals(body);
        const headerMs = retryAfterMs(response, -1);
        const cooldownMs = signals.dailyQuotaExhausted
          ? msUntilNextPtDay(this.now())
          : headerMs >= 0
            ? headerMs
            : (signals.retryAfterMs ?? DEFAULT_COOLDOWN_MS);
        this.deps.governor?.recordCooldown(cooldownMs, modelId);
        quotaContext = {
          retryAfterMs: cooldownMs,
          dailyQuotaExhausted: signals.dailyQuotaExhausted,
          quotaIds: signals.quotaIds,
        };
      }
      throw new GenAIHttpError(
        body.error?.message || `Gemini request failed: ${response.status}`,
        response.status,
        { apiStatus: body.error?.status, model: modelId, ...quotaContext },
      );
    }

    const body = (await response.json()) as GeminiResponseBody;
    // Reconcile with the real cost when the API reports it; else the estimate.
    commit(body.usageMetadata?.totalTokenCount ?? estimate);
    const text = (body.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('');
    return { text, usage: pickUsage(body.usageMetadata) };
  }

  async generateStructured<T>(request: GenAIRequest<T>): Promise<T> {
    const context = request.context;
    return this.executeWithRetry(
      async (modelId) => {
        this.log(
          'request',
          request.method,
          {
            prompt: request.prompt,
            schema: request.responseSchema,
            model: modelId,
            generationConfigOverride: request.generationConfig,
          },
          context,
        );

        const startedAt = this.now();
        const { text, usage } = await this.callGemini(
          modelId,
          request.prompt,
          {
            responseMimeType: 'application/json',
            responseSchema: request.responseSchema,
            ...(request.generationConfig ?? {}),
          },
          context,
          request.signal,
        );
        const latencyMs = this.now() - startedAt;

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          this.log(
            'error',
            request.method,
            {
              message: 'Failed to parse JSON',
              text,
              error: (error as Error).message,
              model: modelId,
              latencyMs,
              usage,
            },
            context,
          );
          const invalid = new GenAIInvalidResponseError(
            'Failed to parse GenAI response as JSON',
            { method: request.method },
            error,
          );
          this.markLogged(invalid);
          throw invalid;
        }

        let validated: T;
        try {
          validated = request.validate(parsed);
        } catch (error) {
          // The raw text rides along so a rejected answer can be audited
          // offline — without it the export only knows the rejection reason.
          this.log(
            'error',
            request.method,
            {
              message: 'Response failed validation',
              error: (error as Error).message,
              text,
              model: modelId,
              latencyMs,
              usage,
            },
            context,
          );
          this.markLogged(error);
          throw error;
        }
        this.log(
          'response',
          request.method,
          { text, parsed, model: modelId, latencyMs, usage },
          context,
        );
        return validated;
      },
      request.method,
      context,
    );
  }

  async generateText(prompt: string, context?: GenAIRequestContext): Promise<string> {
    return this.executeWithRetry(
      async (modelId) => {
        this.log('request', 'generateContent', { prompt, model: modelId }, context);
        const startedAt = this.now();
        const { text, usage } = await this.callGemini(modelId, prompt, undefined, context, undefined);
        this.log(
          'response',
          'generateContent',
          { text, model: modelId, latencyMs: this.now() - startedAt, usage },
          context,
        );
        return text;
      },
      'generateContent',
      context,
    );
  }
}
