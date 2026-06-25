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
 */
import { egress, retryAfterMs, type EgressFn } from '@kernel/net';
import type { QuotaGovernor } from '@kernel/quota';
import {
  GenAIHttpError,
  GenAIInvalidResponseError,
  GenAINotConfiguredError,
  isRetryableForRotation,
} from './errors';
import { redactPayload, type GenAILogEntry, type GenAILogSink } from './logging';
import type {
  GenAIClient,
  GenAIConfigProvider,
  GenAIPrompt,
  GenAIRequest,
  GenAIRequestContext,
} from './contract';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Tiered rotation list: premium models first (20 RPD each), lite fallback
 * last (500 RPD). The list is iterated IN ORDER (no shuffle) — smart models
 * get first crack, and when their daily quota is exhausted (429), the
 * high-quota lite model handles the rest.
 */
export const GENAI_ROTATION_MODELS = [
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
] as const;


function generateLogId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `log_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

interface GeminiResponseBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { totalTokenCount?: number };
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

/** Default cooldown when a 429 carries no usable `Retry-After` header. */
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
}

export class GeminiClient implements GenAIClient {
  constructor(private readonly deps: GeminiClientDeps) {}

  private get egress(): EgressFn {
    return this.deps.egress ?? egress;
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
    let lastError: unknown = null;
    for (const modelId of this.modelsToTry()) {
      try {
        return await operation(modelId);
      } catch (error) {
        lastError = error;
        // Rotate on a server 429 OR a pre-network NET_RATE_LIMITED cooldown (a
        // sibling model's 429 set the governor cooldown, so this model's gateway
        // acquire backpressured before the network) — both leave the remaining
        // models worth trying.
        if (rotationEnabled && isRetryableForRotation(error)) {
          this.log(
            'error',
            method,
            {
              message: `Model ${modelId} unavailable (429 / cooldown backpressure). Retrying with next model...`,
              error: (error as Error).message,
            },
            context,
          );
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  private async callGemini(
    modelId: string,
    prompt: GenAIPrompt,
    generationConfig: Record<string, unknown> | undefined,
    context: GenAIRequestContext | undefined,
    signal: AbortSignal | undefined,
  ): Promise<string> {
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
      // swallows the error the rotation loop branches on).
      if (response.status === 429) {
        this.deps.governor?.recordCooldown(retryAfterMs(response, DEFAULT_COOLDOWN_MS), modelId);
      }
      throw new GenAIHttpError(
        body.error?.message || `Gemini request failed: ${response.status}`,
        response.status,
        { apiStatus: body.error?.status, model: modelId },
      );
    }

    const body = (await response.json()) as GeminiResponseBody;
    // Reconcile with the real cost when the API reports it; else the estimate.
    commit(body.usageMetadata?.totalTokenCount ?? estimate);
    return (body.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('');
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

        const text = await this.callGemini(
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

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          this.log(
            'error',
            request.method,
            { message: 'Failed to parse JSON', text, error: (error as Error).message },
            context,
          );
          throw new GenAIInvalidResponseError(
            'Failed to parse GenAI response as JSON',
            { method: request.method },
            error,
          );
        }

        let validated: T;
        try {
          validated = request.validate(parsed);
        } catch (error) {
          this.log(
            'error',
            request.method,
            {
              message: 'Response failed validation',
              error: (error as Error).message,
            },
            context,
          );
          throw error;
        }
        this.log('response', request.method, { text, parsed }, context);
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
        const text = await this.callGemini(modelId, prompt, undefined, context, undefined);
        this.log('response', 'generateContent', { text }, context);
        return text;
      },
      'generateContent',
      context,
    );
  }
}
