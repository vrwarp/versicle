import { describe, it, expect } from 'vitest';
import {
  APP_ERROR_CODES,
  AppError,
  DatabaseError,
  StorageFullError,
  DuplicateBookError,
  WorkspaceDeletedError,
  NetRateLimitedError,
  type AppErrorCode,
  type AppErrorNamespace,
  type SerializedAppError
} from './errors';

describe('AppErrorCode union', () => {
  it('every code is namespaced (type-level guard)', () => {
    // Compile-time: the whole union must match `<NAMESPACE>_<DETAIL>`. If a
    // non-namespaced code is added to APP_ERROR_CODES, this line stops compiling.
    const allNamespaced: AppErrorCode extends `${AppErrorNamespace}_${string}` ? true : false =
      true;
    expect(allNamespaced).toBe(true);
  });

  it('exhaustiveness guard: every code maps to its namespace', () => {
    // Compile-time exhaustiveness: Record<AppErrorCode, ...> requires a key for every
    // member of the union, so appending a code without updating this map is a type error.
    const namespaceOf: Record<AppErrorCode, AppErrorNamespace> = {
      APP_UNKNOWN: 'APP',
      DB_UNKNOWN: 'DB',
      DB_QUOTA_EXCEEDED: 'DB',
      SYNC_UNKNOWN: 'SYNC',
      SYNC_WORKSPACE_DELETED: 'SYNC',
      SYNC_MIGRATION_FAILED: 'SYNC',
      TTS_UNKNOWN: 'TTS',
      GENAI_UNKNOWN: 'GENAI',
      GENAI_NOT_CONFIGURED: 'GENAI',
      GENAI_INVALID_RESPONSE: 'GENAI',
      DRIVE_UNKNOWN: 'DRIVE',
      DRIVE_API_ERROR: 'DRIVE',
      INGEST_UNKNOWN: 'INGEST',
      INGEST_DUPLICATE_BOOK: 'INGEST',
      INGEST_INVALID_FILE: 'INGEST',
      INGEST_FILE_MISMATCH: 'INGEST',
      INGEST_CANCELLED: 'INGEST',
      INGEST_VERIFICATION_FAILED: 'INGEST',
      SEARCH_UNKNOWN: 'SEARCH',
      SEARCH_SESSION_DISPOSED: 'SEARCH',
      NET_UNKNOWN: 'NET',
      NET_UNKNOWN_DESTINATION: 'NET',
      NET_HOST_NOT_ALLOWED: 'NET',
      NET_CONSENT_REQUIRED: 'NET',
      NET_TIMEOUT: 'NET',
      NET_OFFLINE: 'NET',
      NET_RATE_LIMITED: 'NET',
      BACKUP_SNAPSHOT_INVALID: 'BACKUP',
      GOOGLE_AUTH_REQUIRED: 'GOOGLE',
      GOOGLE_AUTH_REVOKED: 'GOOGLE',
      GOOGLE_AUTH_TRANSIENT: 'GOOGLE',
      GOOGLE_UNKNOWN_SERVICE: 'GOOGLE'
    };
    for (const code of APP_ERROR_CODES) {
      expect(code.startsWith(`${namespaceOf[code]}_`)).toBe(true);
      expect(code).toMatch(/^(APP|DB|SYNC|TTS|GENAI|DRIVE|INGEST|NET|BACKUP|GOOGLE|SEARCH)_[A-Z0-9_]+$/);
    }
  });

  it('has no duplicate codes in the runtime registry', () => {
    expect(new Set<string>(APP_ERROR_CODES).size).toBe(APP_ERROR_CODES.length);
  });

  it('covers the code of every legacy class', () => {
    const legacyCodes: AppErrorCode[] = [
      new AppError('x').code,
      new DatabaseError('x').code,
      new StorageFullError().code,
      new DuplicateBookError('x.epub').code,
      new WorkspaceDeletedError().code
    ];
    for (const code of legacyCodes) {
      expect(APP_ERROR_CODES).toContain(code);
    }
  });
});

describe('AppError', () => {
  it('initializes with message, code, cause, context, and retryable', () => {
    const original = new Error('Original');
    const error = new AppError('App Message', {
      code: 'NET_UNKNOWN',
      cause: original,
      context: { url: 'https://example.com' },
      retryable: true
    });

    expect(error.message).toBe('App Message');
    expect(error.code).toBe('NET_UNKNOWN');
    expect(error.cause).toBe(original);
    expect(error.context).toEqual({ url: 'https://example.com' });
    expect(error.retryable).toBe(true);
    expect(error.name).toBe('AppError');
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });

  it('handles optional parameters', () => {
    const error = new AppError('Simple Message');

    expect(error.message).toBe('Simple Message');
    expect(error.code).toBe('APP_UNKNOWN');
    expect(error.cause).toBeUndefined();
    expect(error.context).toBeUndefined();
    expect(error.originalError).toBeUndefined();
  });

  it('exposes the deprecated originalError alias for cause', () => {
    const original = new Error('Original');
    const error = new AppError('App Message', { cause: original });

    expect(error.originalError).toBe(original);
    expect(error.cause).toBe(original);
  });

  describe('retryable defaults', () => {
    it('defaults to false on the base and every legacy class', () => {
      expect(new AppError('x').retryable).toBe(false);
      expect(new DatabaseError('x').retryable).toBe(false);
      expect(new StorageFullError().retryable).toBe(false);
      expect(new DuplicateBookError('x.epub').retryable).toBe(false);
      expect(new WorkspaceDeletedError().retryable).toBe(false);
    });

    it('can be opted into per instance', () => {
      expect(new AppError('x', { retryable: true }).retryable).toBe(true);
    });
  });

  describe('toJSON / fromJSON', () => {
    it('round-trips code, message, context, retryable, name, and stack', () => {
      const error = new AppError('Boom', {
        code: 'SYNC_UNKNOWN',
        context: { workspaceId: 'ws-1', attempt: 3 },
        retryable: true
      });

      // Through real JSON to prove the wire shape is serializable.
      const json = JSON.parse(JSON.stringify(error)) as SerializedAppError;
      const revived = AppError.fromJSON(json);

      expect(revived).toBeInstanceOf(AppError);
      expect(revived.code).toBe('SYNC_UNKNOWN');
      expect(revived.message).toBe('Boom');
      expect(revived.context).toEqual({ workspaceId: 'ws-1', attempt: 3 });
      expect(revived.retryable).toBe(true);
      expect(revived.name).toBe('AppError');
      expect(revived.stack).toBe(error.stack);
    });

    it('flattens the cause chain to messages, outermost first', () => {
      const root = new Error('root failure');
      const middle = new Error('middle failure', { cause: root });
      const error = new AppError('outer failure', { code: 'DB_UNKNOWN', cause: middle });

      expect(error.toJSON().causeChain).toEqual(['middle failure', 'root failure']);
    });

    it('stringifies non-Error causes and terminates the chain', () => {
      const error = new AppError('outer', { cause: 'plain string cause' });
      expect(error.toJSON().causeChain).toEqual(['plain string cause']);
    });

    it('survives cyclic cause chains', () => {
      const a = new Error('a');
      const b = new Error('b', { cause: a });
      a.cause = b;
      const error = new AppError('outer', { cause: a });

      expect(error.toJSON().causeChain).toEqual(['a', 'b']);
    });

    it('re-serializes a revived error to an identical payload', () => {
      const root = new Error('root failure');
      const error = new AppError('outer failure', {
        code: 'GENAI_UNKNOWN',
        cause: new Error('middle failure', { cause: root }),
        context: { correlationId: 'abc' }
      });

      const first = JSON.parse(JSON.stringify(error)) as SerializedAppError;
      const second = JSON.parse(JSON.stringify(AppError.fromJSON(first))) as SerializedAppError;

      expect(second).toEqual(first);
    });

    it('revives subclass payloads as base AppError, preserving name and code', () => {
      const error = new StorageFullError(new Error('quota'));
      const revived = AppError.fromJSON(JSON.parse(JSON.stringify(error)) as SerializedAppError);

      expect(revived).toBeInstanceOf(AppError);
      expect(revived).not.toBeInstanceOf(StorageFullError);
      expect(revived.name).toBe('StorageFullError');
      expect(revived.code).toBe('DB_QUOTA_EXCEEDED');
      expect(revived.message).toContain('Storage limit exceeded');
      expect(revived.toJSON().causeChain).toEqual(['quota']);
    });
  });
});

describe('DatabaseError', () => {
  it('initializes with DB_UNKNOWN code and cause', () => {
    const original = new Error('DB Fail');
    const error = new DatabaseError('DB Message', original);

    expect(error.message).toBe('DB Message');
    expect(error.code).toBe('DB_UNKNOWN');
    expect(error.cause).toBe(original);
    expect(error.originalError).toBe(original);
    expect(error.name).toBe('DatabaseError');
  });

  it('instanceof chain: DatabaseError -> AppError -> Error', () => {
    const error = new DatabaseError('DB Message');
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('StorageFullError', () => {
  it('initializes with default message and DB_QUOTA_EXCEEDED code', () => {
    const original = new Error('Quota exceeded');
    const error = new StorageFullError(original);

    expect(error.message).toContain('Storage limit exceeded');
    expect(error.code).toBe('DB_QUOTA_EXCEEDED');
    expect(error.cause).toBe(original);
    expect(error.originalError).toBe(original);
    expect(error.name).toBe('StorageFullError');
  });

  it('instanceof chain: StorageFullError -> DatabaseError -> AppError -> Error', () => {
    const error = new StorageFullError();
    expect(error).toBeInstanceOf(StorageFullError);
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('DuplicateBookError', () => {
  it('initializes with INGEST_DUPLICATE_BOOK code, filename, and context', () => {
    const filename = 'test-book.epub';
    const error = new DuplicateBookError(filename);

    expect(error.message).toContain(filename);
    expect(error.code).toBe('INGEST_DUPLICATE_BOOK');
    expect(error.filename).toBe(filename);
    expect(error.context).toEqual({ filename });
    expect(error.name).toBe('DuplicateBookError');
  });

  it('instanceof chain: DuplicateBookError -> AppError -> Error', () => {
    const error = new DuplicateBookError('test-book.epub');
    expect(error).toBeInstanceOf(DuplicateBookError);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('NetRateLimitedError', () => {
  it('carries NET_RATE_LIMITED code, retryable true, and retryAfterMs in context', () => {
    const error = new NetRateLimitedError(1500, { lane: 'fg', reason: 'rpd-exhausted' });

    expect(error.code).toBe('NET_RATE_LIMITED');
    expect(error.retryable).toBe(true);
    expect(error.context).toMatchObject({ retryAfterMs: 1500, lane: 'fg', reason: 'rpd-exhausted' });
    expect(error.name).toBe('NetRateLimitedError');
  });

  it('instanceof chain: NetRateLimitedError -> AppError -> Error', () => {
    const error = new NetRateLimitedError(0);
    expect(error).toBeInstanceOf(NetRateLimitedError);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('WorkspaceDeletedError', () => {
  it('initializes with default message and SYNC_WORKSPACE_DELETED code', () => {
    const error = new WorkspaceDeletedError();

    expect(error.message).toBe('This workspace has been deleted.');
    expect(error.code).toBe('SYNC_WORKSPACE_DELETED');
    expect(error.name).toBe('WorkspaceDeletedError');
  });

  it('initializes with custom message', () => {
    const message = 'Custom deletion message';
    const error = new WorkspaceDeletedError(message);

    expect(error.message).toBe(message);
  });

  it('instanceof chain: WorkspaceDeletedError -> AppError -> Error', () => {
    const error = new WorkspaceDeletedError();
    expect(error).toBeInstanceOf(WorkspaceDeletedError);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });
});
