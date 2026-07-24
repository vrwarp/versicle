/**
 * Versicle error taxonomy (overhaul item C10).
 *
 * One `AppError` base carries the whole contract:
 *
 * - `code` — a stable string-literal union ({@link AppErrorCode}). Codes are **append-only**:
 *   never rename or remove a member, only add. Codes are namespaced by domain
 *   (`APP_*`, `DB_*`, `SYNC_*`, `TTS_*`, `GENAI_*`, `DRIVE_*`, `INGEST_*`, `NET_*`) so callers
 *   branch with `instanceof` / `code` equality — never by message-substring matching.
 * - `cause` — the standard ES2022 `Error.cause`, replacing the legacy `originalError` field
 *   (which remains as a deprecated alias).
 * - `context` — optional structured details (ids, filenames, HTTP status, …) safe to log.
 * - `retryable` — whether an automatic retry of the failed operation is reasonable.
 *   Defaults to `false`.
 * - `toJSON()` / `AppError.fromJSON()` — lossless-enough serialization for worker/Comlink
 *   boundary crossings: `code`, `message`, `context`, `retryable` (and `name`/`stack`)
 *   round-trip exactly; the `cause` chain is flattened to a message chain
 *   ({@link SerializedAppError.causeChain}). Subclass identity is intentionally **not**
 *   revived — `code` is the stable discriminant across boundaries.
 *
 * ## Mapping-helper convention (the `handleDbError` pattern)
 *
 * Vendor/raw errors are mapped to typed `AppError`s at **exactly one module per boundary** —
 * the proven shape came from the deleted DBService's `handleDbError` (it lives
 * on at src/data/errors.ts): a small
 * `handleXxxError(error: unknown): never` helper that
 *
 *   1. logs via the boundary's scoped logger,
 *   2. rethrows errors that are already typed (`if (error instanceof AppError) throw error`),
 *   3. maps known vendor shapes to specific subclasses/codes
 *      (e.g. `QuotaExceededError` → `StorageFullError`), and
 *   4. falls through to the domain's generic code (e.g. `DB_UNKNOWN`) with the raw error
 *      attached as `cause`.
 *
 * Every `catch` in a boundary module funnels through its helper; layers above the boundary
 * only ever see `AppError`s. Repo-wide adoption (sync, TTS providers, GenAI, Drive,
 * ingestion) happens in later phases — this module only defines the contract.
 */

/**
 * Runtime registry of the code namespaces. Append-only.
 * @public C10 contract surface: the `AppErrorNamespace` union derives from
 * this tuple — kept exported as the append-only registry of namespaces.
 */
export const APP_ERROR_NAMESPACES = [
  'APP',
  'DB',
  'SYNC',
  'TTS',
  'GENAI',
  'DRIVE',
  'INGEST',
  'NET',
  'BACKUP',
  'GOOGLE',
  'SEARCH',
] as const;

/** Domain namespaces for {@link AppErrorCode}. Append-only. */
export type AppErrorNamespace = (typeof APP_ERROR_NAMESPACES)[number];

/**
 * Runtime registry of every known error code.
 *
 * **Append-only**: persisted diagnostics and cross-version worker messages may carry old
 * codes, so members are never renamed or removed. The `satisfies` clause rejects any code
 * that is not `<NAMESPACE>_<DETAIL>` at compile time.
 */
export const APP_ERROR_CODES = [
  // APP_* — generic / cross-cutting.
  'APP_UNKNOWN',
  // DB_* — IndexedDB / local persistence.
  'DB_UNKNOWN',
  'DB_QUOTA_EXCEEDED',
  // SYNC_* — Firestore/Yjs sync.
  'SYNC_UNKNOWN',
  'SYNC_WORKSPACE_DELETED',
  'SYNC_MIGRATION_FAILED',
  // TTS_* — speech engine and providers.
  'TTS_UNKNOWN',
  // GENAI_* — Gemini structured-output boundary.
  'GENAI_UNKNOWN',
  'GENAI_NOT_CONFIGURED',
  'GENAI_INVALID_RESPONSE',
  'GENAI_EMBEDDING_NOT_CONFIGURED',
  // DRIVE_* — Google Drive HTTP boundary.
  'DRIVE_UNKNOWN',
  'DRIVE_API_ERROR',
  // A ranged (partial) download returned 200 instead of 206: the server
  // ignored the Range header, so the caller must fall back to a full download.
  'DRIVE_RANGE_UNSUPPORTED',
  // INGEST_* — book import / EPUB ingestion.
  'INGEST_UNKNOWN',
  'INGEST_DUPLICATE_BOOK',
  'INGEST_INVALID_FILE',
  'INGEST_FILE_MISMATCH',
  'INGEST_CANCELLED',
  'INGEST_VERIFICATION_FAILED',
  // SEARCH_* — the in-book search engine/session (Phase 7).
  'SEARCH_UNKNOWN',
  'SEARCH_SESSION_DISPOSED',
  // NET_* — generic network/fetch failures + the kernel/net egress gateway (Phase 7).
  'NET_UNKNOWN',
  'NET_UNKNOWN_DESTINATION',
  'NET_HOST_NOT_ALLOWED',
  'NET_CONSENT_REQUIRED',
  'NET_TIMEOUT',
  'NET_OFFLINE',
  // Request refused locally by the rate/spend governor before any network call
  // (distinct from a server-sent 429). Append-only.
  'NET_RATE_LIMITED',
  // BACKUP_* — backup/snapshot capture, validation, and restore.
  'BACKUP_SNAPSHOT_INVALID',
  // GOOGLE_* — Google OAuth boundary (GoogleAuthClient, Phase 7).
  'GOOGLE_AUTH_REQUIRED',
  'GOOGLE_AUTH_REVOKED',
  'GOOGLE_AUTH_TRANSIENT',
  'GOOGLE_UNKNOWN_SERVICE',
] as const satisfies readonly `${AppErrorNamespace}_${Uppercase<string>}`[];

/** Stable, append-only union of error codes. See {@link APP_ERROR_CODES}. */
export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/** Options bag for {@link AppError} and its subclasses. */
export interface AppErrorOptions {
  /** Stable code; defaults to `'APP_UNKNOWN'`. */
  code?: AppErrorCode;
  /** Underlying failure, stored as ES2022 `Error.cause`. */
  cause?: unknown;
  /** Structured, log-safe details (ids, filenames, HTTP status, …). */
  context?: Record<string, unknown>;
  /** Whether automatically retrying the operation is reasonable. Defaults to `false`. */
  retryable?: boolean;
}

/**
 * Wire shape produced by {@link AppError.toJSON} and consumed by {@link AppError.fromJSON}.
 * JSON-safe for `postMessage`/Comlink and `JSON.stringify`.
 */
export interface SerializedAppError {
  name: string;
  code: AppErrorCode;
  message: string;
  retryable: boolean;
  context?: Record<string, unknown>;
  /** Messages of the `cause` chain, outermost (direct cause) first. */
  causeChain: string[];
  stack?: string;
}

/** Upper bound on how many `cause` links are walked during serialization. */
const MAX_CAUSE_CHAIN_LENGTH = 16;

/**
 * Flatten a `cause` chain into its messages, outermost first.
 * Non-`Error` causes are stringified and terminate the chain; cycles and
 * over-long chains are cut off defensively.
 */
function flattenCauseChain(cause: unknown): string[] {
  const chain: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = cause;
  while (
    current !== undefined &&
    current !== null &&
    !seen.has(current) &&
    chain.length < MAX_CAUSE_CHAIN_LENGTH
  ) {
    seen.add(current);
    if (current instanceof Error) {
      chain.push(current.message);
      current = current.cause;
    } else {
      chain.push(String(current));
      break;
    }
  }
  return chain;
}

/**
 * Base class for all application-specific errors. See the module docs for the contract.
 */
export class AppError extends Error {
  /** Stable, append-only error code. The discriminant for programmatic handling. */
  readonly code: AppErrorCode;
  /** Structured, log-safe details attached at the throw site. */
  readonly context?: Record<string, unknown>;
  /** Whether automatically retrying the failed operation is reasonable. */
  readonly retryable: boolean;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code ?? 'APP_UNKNOWN';
    this.context = options.context;
    this.retryable = options.retryable ?? false;
  }

  /**
   * @deprecated Pre-taxonomy alias of ES2022 `Error.cause`; use `cause` instead.
   */
  get originalError(): unknown {
    return this.cause;
  }

  /**
   * Serialize for a worker/Comlink boundary crossing (also picked up by
   * `JSON.stringify`). `code`/`message`/`context`/`retryable` round-trip exactly;
   * the `cause` chain is flattened to messages.
   */
  toJSON(): SerializedAppError {
    const json: SerializedAppError = {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      causeChain: flattenCauseChain(this.cause),
    };
    if (this.context !== undefined) {
      json.context = this.context;
    }
    if (this.stack !== undefined) {
      json.stack = this.stack;
    }
    return json;
  }

  /**
   * Revive a serialized error on the other side of a boundary. Returns a base
   * `AppError` (subclass identity is not revived — branch on `code`); `name` and
   * `stack` are restored, and the flattened cause chain is rebuilt as nested plain
   * `Error`s so the revived error re-serializes identically.
   */
  static fromJSON(json: SerializedAppError): AppError {
    let cause: Error | undefined;
    for (let i = json.causeChain.length - 1; i >= 0; i--) {
      cause =
        cause === undefined
          ? new Error(json.causeChain[i])
          : new Error(json.causeChain[i], { cause });
    }
    const error = new AppError(json.message, {
      code: json.code,
      context: json.context,
      retryable: json.retryable,
      cause,
    });
    error.name = json.name;
    if (json.stack !== undefined) {
      error.stack = json.stack;
    }
    return error;
  }
}

/**
 * Error thrown when a database operation fails.
 *
 * The optional third parameter lets subclasses refine the taxonomy fields while the
 * legacy `(message, originalError?)` call sites keep working unchanged.
 */
export class DatabaseError extends AppError {
  /**
   * @param message - The error message.
   * @param originalError - The original error (stored as `cause`).
   * @param options - Taxonomy refinements; `code` defaults to `'DB_UNKNOWN'`.
   */
  constructor(message: string, originalError?: unknown, options: AppErrorOptions = {}) {
    super(message, { code: 'DB_UNKNOWN', cause: originalError, ...options });
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
    super('Storage limit exceeded. Please delete some books or clear space.', originalError, {
      code: 'DB_QUOTA_EXCEEDED',
    });
    this.name = 'StorageFullError';
  }
}

/**
 * Error thrown when attempting to add a book that already exists.
 */
export class DuplicateBookError extends AppError {
  constructor(public filename: string) {
    super(`A book with the filename "${filename}" already exists.`, {
      code: 'INGEST_DUPLICATE_BOOK',
      context: { filename },
    });
    this.name = 'DuplicateBookError';
  }
}

/**
 * Error thrown when a workspace has been tombstoned.
 */
export class WorkspaceDeletedError extends AppError {
  constructor(message: string = 'This workspace has been deleted.') {
    super(message, { code: 'SYNC_WORKSPACE_DELETED' });
    this.name = 'WorkspaceDeletedError';
  }
}

/**
 * Raised by the rate/spend governor when it refuses a request **before any
 * network call** — the daily request budget is exhausted, an earlier 429 put
 * the endpoint in cooldown, or the rolling per-minute request/token budget is
 * spent.
 *
 * Distinct from a server-sent 429 (the `GenAIHttpError` / `isResourceExhausted`
 * path): that one means the server pushed back; this one means we throttled
 * ourselves first. Like {@link NetTimeoutError}/{@link NetOfflineError} it is
 * `retryable: true`, and it carries `retryAfterMs` in `context` so callers and
 * meters can branch on `code === 'NET_RATE_LIMITED'` (never message substrings)
 * and schedule a retry.
 *
 * It extends {@link AppError} directly (not `NetworkGatewayError`, which lives in
 * `kernel/net`) because the throw site — `kernel/quota` — is bound by
 * `kernel-imports-nothing` (kernel may import only `~types`); `kernel/net`
 * re-exports it so the net layer can reference it under its own surface.
 */
export class NetRateLimitedError extends AppError {
  constructor(retryAfterMs: number, context: Record<string, unknown> = {}) {
    super('Rate limited: request refused before egress (quota backpressure).', {
      code: 'NET_RATE_LIMITED',
      context: { retryAfterMs, ...context },
      retryable: true,
    });
    this.name = 'NetRateLimitedError';
  }
}
