/**
 * Typed embedding errors (Increment C §1; append-only GENAI_* code, mirrors
 * errors.ts:7 GenAINotConfiguredError).
 */
import { AppError } from '~types/errors';

/**
 * No API key configured for the embedding client. Thrown by the
 * NOT-CONFIGURED holder default's `embed()` so a stray import degrades exactly
 * like a missing key instead of crashing (the GenAINotConfiguredError parallel).
 */
export class EmbeddingNotConfiguredError extends AppError {
  constructor() {
    super('GenAI embedding not configured (missing API key).', {
      code: 'GENAI_EMBEDDING_NOT_CONFIGURED',
    });
    this.name = 'EmbeddingNotConfiguredError';
  }
}
