/**
 * Base class for application-specific errors.
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Generic error for database operations.
 */
export class DatabaseError extends AppError {
  constructor(message: string, public originalError?: unknown) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * Specific error indicating the storage quota has been exceeded.
 */
export class StorageFullError extends DatabaseError {
  constructor(message = 'Storage is full. Please delete some books or clear cache.') {
    super(message);
    this.name = 'StorageFullError';
  }
}
