/**
 * GenAIClient contract (C9). The interface the per-feature modules
 * (./features/*) and the app-layer TTS GenAI port (src/app/tts/genaiPort.ts)
 * consume; implementations: GeminiClient (REST via the kernel NetworkGateway)
 * and MockGenAIClient (composition-root/test builds only — boundary rule 9).
 */

/** Gemini JSON-mode response schema type names (SDK-compatible, lowercase). */
export const SchemaType = {
  STRING: 'string',
  NUMBER: 'number',
  INTEGER: 'integer',
  BOOLEAN: 'boolean',
  ARRAY: 'array',
  OBJECT: 'object',
} as const;

export type GenAIPromptPart =
  | { text: string }
  | { inlineData: { data: string; mimeType: string } };

/** Either a plain text prompt or a full multi-part contents payload. */
export type GenAIPrompt =
  | string
  | { contents: { role: string; parts: GenAIPromptPart[] }[] };

export interface GenAIRequestContext {
  /**
   * The book whose content this request transmits — feeds the gateway's
   * per-book consent gate. Optional: the TTS analysis callers thread it
   * through the EngineContext GenAI port; a call without one is allowed by
   * the app-installed consent resolver (src/app/google/aiConsent.ts).
   */
  bookId?: string;
  bookTitle?: string;
  sectionTitle?: string;
  language?: string;
  correlationId?: string;
  /** True when an explicit user gesture drove this exact call. */
  interactive?: boolean;
}

export interface GenAIRequest<T> {
  /** Method name for the activity log. */
  method: string;
  prompt: GenAIPrompt;
  /** Sent to the API (Gemini JSON mode). */
  responseSchema: object;
  /**
   * REQUIRED semantic validation (GG-5): zod parse + input-membership
   * checks. Throws GenAIInvalidResponseError on out-of-contract output —
   * bad model output must never reach persisted state.
   */
  validate: (raw: unknown) => T;
  /** Extra generationConfig fields (e.g. thinkingConfig). */
  generationConfig?: Record<string, unknown>;
  context?: GenAIRequestContext;
  signal?: AbortSignal;
}

export interface GenAIClient {
  generateStructured<T>(request: GenAIRequest<T>): Promise<T>;
  /** Plain-text generation. */
  generateText(prompt: string, context?: GenAIRequestContext): Promise<string>;
  /** Whether the client currently holds a usable configuration. */
  isConfigured(): boolean;
}

export interface GenAIConfig {
  apiKey: string;
  model: string;
  rotationEnabled: boolean;
}

/**
 * Read per call (never cached): every request sees the live model selection,
 * so no caller can clobber it through a mutable singleton config (GG-8).
 */
export type GenAIConfigProvider = () => GenAIConfig;
