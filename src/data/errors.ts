/**
 * Error mapping at the storage boundary: `handleDbError` maps raw failures
 * onto the typed database errors for the data layer.
 */
import { DatabaseError, StorageFullError } from '~types/errors';
import { createLogger } from '@lib/logger';

const logger = createLogger('DBService');

/**
 * Map a raw failure to the typed database errors. Shared by every data repo so
 * error semantics stay identical across them.
 */
export function handleDbError(error: unknown): never {
  logger.error('Database operation failed', error);

  if (error instanceof DatabaseError) {
    throw error;
  }

  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') {
      throw new StorageFullError(error);
    }
  }
  // Check if it's a DOMException with code 22 (QuotaExceededError legacy)
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    throw new StorageFullError(error);
  }

  throw new DatabaseError('An unexpected database error occurred', error);
}
