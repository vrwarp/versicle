export class AppError extends Error {
  constructor(message: string, public code?: string, public originalError?: unknown) {
    super(message);
    this.name = 'AppError';
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, originalError?: unknown) {
    super(message, 'DATABASE_ERROR', originalError);
    this.name = 'DatabaseError';
  }
}

export class StorageFullError extends DatabaseError {
  constructor(originalError?: unknown) {
    super('Storage limit exceeded. Please delete some books or clear space.', originalError);
    this.name = 'StorageFullError';
  }
}
