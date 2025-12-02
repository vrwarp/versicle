export class AppError extends Error {
  constructor(message: string, public originalError?: unknown) {
    super(message);
    this.name = 'AppError';
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, originalError?: unknown) {
    super(message, originalError);
    this.name = 'DatabaseError';
  }
}

export class StorageFullError extends DatabaseError {
  constructor(message: string = 'Storage limit exceeded. Please delete some items.') {
    super(message);
    this.name = 'StorageFullError';
  }
}

export class NotFoundError extends DatabaseError {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
