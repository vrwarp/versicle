/**
 * AnthropicClient — the production GenAIClient over the Claude Messages API,
 * routed through `NetworkGateway.egress('anthropic', …)`. Sibling of
 * GeminiClient; both satisfy the same contract so every feature module and the
 * TTS pipeline are provider-agnostic.
 *
 * Design points (parallel to GeminiClient):
 *  - Config read PER CALL from the injected provider — no mutable singleton.
 *  - REST via the kernel gateway (never a raw SDK) so consent + quota admission
 *    at the network chokepoint cannot be bypassed.
 *  - Structured output uses FORCED TOOL USE (Claude has no Gemini JSON-mode): the
 *    feature's responseSchema becomes a single tool's input_schema and
 *    `tool_choice` forces it; the returned `tool_use.input` is already a parsed
 *    object (no JSON.parse). `validate` (GG-5) still runs on every response.
 *  - Logs record the ORIGINAL GenAIPrompt (Gemini inlineData shape) so
 *    redactPayload strips image bytes unchanged, and carry provider+model so the
 *    activity log shows exactly what was called.
 *  - No model rotation (a Gemini-only feature): Claude uses its single
 *    configured model.
 *
 * The browser CORS path REQUIRES the `anthropic-dangerous-direct-browser-access`
 * header; versicle is a browser/Capacitor app talking to the API directly with a
 * user-supplied key.
 */
import { egress, retryAfterMs, type EgressFn } from '@kernel/net';
import {
  GenAIHttpError,
  GenAIInvalidResponseError,
  GenAINotConfiguredError,
} from './errors';
import { redactPayload, type GenAILogEntry, type GenAILogSink } from './logging';
import { promptToMessages, schemaToTool, STRUCTURED_TOOL_NAME } from './anthropicTranslate';
import type { GenAIQuotaGovernor } from './GeminiClient';
import type {
  GenAIClient,
  GenAIConfigProvider,
  GenAIPrompt,
  GenAIRequest,
  GenAIRequestContext,
} from './contract';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
/** The dated Messages API version the request shape below targets. */
const ANTHROPIC_VERSION = '2023-06-01';
/** Claude requires an explicit output cap; the feature outputs are all small. */
const DEFAULT_MAX_TOKENS = 4096;
/** Default cooldown when a 429 carries no usable `Retry-After` header. */
const DEFAULT_COOLDOWN_MS = 30_000;

function generateLogId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `log_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

/** ~4-chars-per-token estimate over the serialized prompt for pre-flight admission. */
function estTokens(prompt: GenAIPrompt): number {
  const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt.contents);
  return Math.ceil(text.length / 4);
}

type AnthropicContentBlockOut =
  | { type: 'text'; text?: string }
  | { type: 'tool_use'; name?: string; input?: unknown }
  | { type: string; [k: string]: unknown };

interface AnthropicResponseBody {
  content?: AnthropicContentBlockOut[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
  error?: { type?: string; message?: string };
}

export interface AnthropicClientDeps {
  getConfig: GenAIConfigProvider;
  /** Injected for tests; production uses the kernel gateway. */
  egress?: EgressFn;
  /** Activity-log sink (entries arrive pre-redacted). */
  onLog?: GenAILogSink;
  /** AI-API rate/spend limiter (commit + cooldown from the parsed response). */
  governor?: GenAIQuotaGovernor;
}

export class AnthropicClient implements GenAIClient {
  constructor(private readonly deps: AnthropicClientDeps) {}

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
    model?: string,
  ): void {
    this.deps.onLog?.({
      id: generateLogId(),
      timestamp: Date.now(),
      type,
      method,
      payload: redactPayload(payload),
      provider: 'anthropic',
      model,
      bookTitle: context?.bookTitle,
      sectionTitle: context?.sectionTitle,
      correlationId: context?.correlationId,
    });
  }

  private requireConfigured(method: string, context?: GenAIRequestContext): string {
    const config = this.deps.getConfig();
    if (config.apiKey === '') {
      const error = new GenAINotConfiguredError();
      this.log('error', method, { message: error.message }, context);
      throw error;
    }
    return config.model;
  }

  /**
   * One Messages call: gateway egress, error/429 handling, and the post-response
   * quota commit that needs the parsed usage the network layer never reads.
   */
  private async callMessages(
    model: string,
    body: Record<string, unknown>,
    prompt: GenAIPrompt,
    context: GenAIRequestContext | undefined,
    signal: AbortSignal | undefined,
  ): Promise<AnthropicResponseBody> {
    const config = this.deps.getConfig();
    const estimate = estTokens(prompt);

    const response = await this.egress(
      'anthropic',
      ANTHROPIC_API_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          // Required for the direct-from-browser CORS path.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model, max_tokens: DEFAULT_MAX_TOKENS, ...body }),
      },
      {
        signal,
        consent: { bookId: context?.bookId, interactive: context?.interactive },
        lane: 'fg',
        estTokens: estimate,
        ratePool: model,
      },
    );

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as AnthropicResponseBody;
      if (response.status === 429) {
        this.deps.governor?.recordCooldown(retryAfterMs(response, DEFAULT_COOLDOWN_MS), model);
      }
      throw new GenAIHttpError(
        errBody.error?.message || `Anthropic request failed: ${response.status}`,
        response.status,
        { apiStatus: errBody.error?.type, model },
      );
    }

    const parsed = (await response.json()) as AnthropicResponseBody;
    const used =
      (parsed.usage?.input_tokens ?? 0) + (parsed.usage?.output_tokens ?? 0);
    this.deps.governor?.commit('fg', used || estimate, model);
    return parsed;
  }

  async generateStructured<T>(request: GenAIRequest<T>): Promise<T> {
    const context = request.context;
    const model = this.requireConfigured(request.method, context);
    const { tool, unwrap } = schemaToTool(request.responseSchema);

    this.log(
      'request',
      request.method,
      { prompt: request.prompt, schema: request.responseSchema, model },
      context,
      model,
    );

    const parsed = await this.callMessages(
      model,
      {
        messages: promptToMessages(request.prompt),
        tools: [tool],
        tool_choice: { type: 'tool', name: STRUCTURED_TOOL_NAME },
      },
      request.prompt,
      context,
      request.signal,
    );

    const toolUse = (parsed.content ?? []).find(
      (b): b is { type: 'tool_use'; name?: string; input?: unknown } => b.type === 'tool_use',
    );
    if (!toolUse) {
      this.log(
        'error',
        request.method,
        { message: 'No tool_use block in Claude response', stopReason: parsed.stop_reason },
        context,
        model,
      );
      throw new GenAIInvalidResponseError(
        'Claude returned no tool_use block (possible refusal)',
        { method: request.method, stopReason: parsed.stop_reason },
      );
    }

    const raw = unwrap(toolUse.input);
    let validated: T;
    try {
      validated = request.validate(raw);
    } catch (error) {
      this.log(
        'error',
        request.method,
        { message: 'Response failed validation', error: (error as Error).message },
        context,
        model,
      );
      throw error;
    }
    this.log('response', request.method, { input: raw }, context, model);
    return validated;
  }

  async generateText(prompt: string, context?: GenAIRequestContext): Promise<string> {
    const model = this.requireConfigured('generateContent', context);
    this.log('request', 'generateContent', { prompt, model }, context, model);
    const parsed = await this.callMessages(
      model,
      { messages: promptToMessages(prompt) },
      prompt,
      context,
      undefined,
    );
    const text = (parsed.content ?? [])
      .map((b) => (b.type === 'text' ? ((b as { text?: string }).text ?? '') : ''))
      .join('');
    this.log('response', 'generateContent', { text }, context, model);
    return text;
  }
}
