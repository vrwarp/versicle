/**
 * Typed GenAI errors (Phase 7 §H; C10 codes GENAI_*).
 */
import { AppError } from '~types/errors';

/** No API key configured. Message kept verbatim — UI surfaces it. */
export class GenAINotConfiguredError extends AppError {
  constructor() {
    super('GenAI Service not configured (missing API key).', {
      code: 'GENAI_NOT_CONFIGURED',
    });
    this.name = 'GenAINotConfiguredError';
  }
}

/**
 * The model returned out-of-contract output (unparseable JSON, schema
 * breach, out-of-range index, hallucinated ids). Callers mark
 * status:'error' via the existing markAnalysisError machinery — bad model
 * output stops poisoning the synced contentAnalysis map (GG-5).
 */
export class GenAIInvalidResponseError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, cause?: unknown) {
    super(message, { code: 'GENAI_INVALID_RESPONSE', context, cause });
    this.name = 'GenAIInvalidResponseError';
  }
}

/** HTTP-level failure from the Gemini endpoint (carries the status). */
export class GenAIHttpError extends AppError {
  constructor(
    message: string,
    public readonly status: number,
    context?: Record<string, unknown>,
  ) {
    super(message, {
      code: 'GENAI_UNKNOWN',
      context: { status, ...context },
      retryable: status === 429 || status >= 500,
    });
    this.name = 'GenAIHttpError';
  }
}

/** 429 / quota detection for the rotation retry (typed, no string sniffing). */
export function isResourceExhausted(error: unknown): boolean {
  return error instanceof GenAIHttpError && error.status === 429;
}
