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
import { egress, type EgressFn } from '@kernel/net';
import {
  GenAIHttpError,
  GenAIInvalidResponseError,
  GenAINotConfiguredError,
  isResourceExhausted,
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

/** The ONE rotation list (was duplicated between service + settings copy). */
export const GENAI_ROTATION_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'] as const;

function fisherYatesShuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function generateLogId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `log_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

interface GeminiResponseBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { code?: number; message?: string; status?: string };
}

export interface GeminiClientDeps {
  getConfig: GenAIConfigProvider;
  /** Injected for tests; production uses the kernel gateway. */
  egress?: EgressFn;
  /** Activity-log sink (entries arrive pre-redacted). */
  onLog?: GenAILogSink;
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
      ? fisherYatesShuffle([...GENAI_ROTATION_MODELS])
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
        if (rotationEnabled && isResourceExhausted(error)) {
          this.log(
            'error',
            method,
            {
              message: `Model ${modelId} exhausted (429). Retrying with next model...`,
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
      },
    );

    if (!response.ok) {
      const body = (await response
        .json()
        .catch(() => ({}))) as GeminiResponseBody;
      throw new GenAIHttpError(
        body.error?.message || `Gemini request failed: ${response.status}`,
        response.status,
        { apiStatus: body.error?.status, model: modelId },
      );
    }

    const body = (await response.json()) as GeminiResponseBody;
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
