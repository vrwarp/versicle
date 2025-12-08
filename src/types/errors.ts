/**
 * Base class for application-specific errors.
 */
export class AppError extends Error {
  /**
   * @param message - The error message.
   * @param code - Optional error code.
   * @param originalError - The original error that caused this one (if any).
   */
  constructor(message: string, public code?: string, public originalError?: unknown) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Error thrown when a database operation fails.
 */
export class DatabaseError extends AppError {
  /**
   * @param message - The error message.
   * @param originalError - The original error.
   */
  constructor(message: string, originalError?: unknown) {
    super(message, 'DATABASE_ERROR', originalError);
    this.name = 'DatabaseError';
  }
}

/**
 * Error thrown when the storage quota is exceeded (IndexedDB).
 */
export class StorageFullError extends DatabaseError {
  /**
   * @param originalError - The original QuotaExceededError.
   */
  constructor(originalError?: unknown) {
    super('Storage limit exceeded. Please delete some books or clear space.', originalError);
    this.name = 'StorageFullError';
  }
}
