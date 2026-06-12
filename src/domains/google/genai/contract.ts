/**
 * GenAIClient contract (Phase 7 §H; C9). The interface the per-feature
 * modules (./features/*) and the legacy GenAIService façade consume;
 * implementations: GeminiClient (REST via the kernel NetworkGateway) and
 * MockGenAIClient (composition-root/test builds only — boundary rule 9).
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
   * per-book consent gate. Optional today: the TTS pipeline's EngineContext
   * port does not carry bookId yet (P5c narrows it); absent bookId resolves
   * per the app-installed consent resolver's legacy-allow rule.
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
  /** Plain-text generation (legacy GenAIService.generateContent surface). */
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
 * Read per call (never cached): kills the mutable-singleton clobber where
 * the TTS pipeline's hardcoded configure(apiKey, 'gemini-1.5-flash')
 * switched every subsequent request's model (GG-8).
 */
export type GenAIConfigProvider = () => GenAIConfig;
