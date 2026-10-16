/**
 * Typed embedding errors (append-only GENAI_* code; mirrors
 * GenAINotConfiguredError in ../errors.ts).
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
