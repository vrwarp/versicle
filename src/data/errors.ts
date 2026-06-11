/**
 * Error mapping at the storage boundary (Phase 3; relocated VERBATIM from
 * src/db/DBService.ts so the data layer owns it — `handleDbError` boundary
 * mapping is on the program's explicit keeper list).
 */
import { DatabaseError, StorageFullError } from '~types/errors';
import { createLogger } from '@lib/logger';

// Keeps the log namespace the relocated function has always used.
const logger = createLogger('DBService');

/**
 * Map a raw failure to the typed database errors. Shared with the services that layer on
 * top of DBService (e.g. BookImportService) so error semantics stay identical across the split.
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
