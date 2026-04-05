import { describe, it, expect } from 'vitest';
import {
  AppError,
  DatabaseError,
  StorageFullError,
  DuplicateBookError,
  WorkspaceDeletedError
} from './errors';

describe('Custom Errors', () => {
  describe('AppError', () => {
    it('should initialize with message, code, and originalError', () => {
      const original = new Error('Original');
      const error = new AppError('App Message', 'ERR_CODE', original);

      expect(error.message).toBe('App Message');
      expect(error.code).toBe('ERR_CODE');
      expect(error.originalError).toBe(original);
      expect(error.name).toBe('AppError');
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should handle optional parameters', () => {
      const error = new AppError('Simple Message');

      expect(error.message).toBe('Simple Message');
      expect(error.code).toBeUndefined();
      expect(error.originalError).toBeUndefined();
    });
  });

  describe('DatabaseError', () => {
    it('should initialize with DATABASE_ERROR code', () => {
      const original = new Error('DB Fail');
      const error = new DatabaseError('DB Message', original);

      expect(error.message).toBe('DB Message');
      expect(error.code).toBe('DATABASE_ERROR');
      expect(error.originalError).toBe(original);
      expect(error.name).toBe('DatabaseError');
      expect(error).toBeInstanceOf(DatabaseError);
      expect(error).toBeInstanceOf(AppError);
    });
  });

  describe('StorageFullError', () => {
    it('should initialize with default message and database-related properties', () => {
      const original = new Error('Quota exceeded');
      const error = new StorageFullError(original);

      expect(error.message).toContain('Storage limit exceeded');
      expect(error.code).toBe('DATABASE_ERROR');
      expect(error.originalError).toBe(original);
      expect(error.name).toBe('StorageFullError');
      expect(error).toBeInstanceOf(StorageFullError);
      expect(error).toBeInstanceOf(DatabaseError);
    });
  });

  describe('DuplicateBookError', () => {
    it('should initialize with DUPLICATE_BOOK code and filename', () => {
      const filename = 'test-book.epub';
      const error = new DuplicateBookError(filename);

      expect(error.message).toContain(filename);
      expect(error.code).toBe('DUPLICATE_BOOK');
      expect(error.filename).toBe(filename);
      expect(error.name).toBe('DuplicateBookError');
      expect(error).toBeInstanceOf(DuplicateBookError);
      expect(error).toBeInstanceOf(AppError);
    });
  });

  describe('WorkspaceDeletedError', () => {
    it('should initialize with default message', () => {
      const error = new WorkspaceDeletedError();

      expect(error.message).toBe('This workspace has been deleted.');
      expect(error.name).toBe('WorkspaceDeletedError');
      expect(error).toBeInstanceOf(WorkspaceDeletedError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should initialize with custom message', () => {
      const message = 'Custom deletion message';
      const error = new WorkspaceDeletedError(message);

      expect(error.message).toBe(message);
    });
  });
});
