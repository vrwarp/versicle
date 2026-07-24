/**
 * Typed Drive HTTP errors (Phase 7 §G; C10 code DRIVE_API_ERROR) + the
 * boundary mapping helper (the documented `handleDbError` convention from
 * ~types/errors): every catch in the Drive boundary funnels through
 * `handleDriveError`; layers above only ever see AppErrors.
 */
import { AppError } from '~types/errors';

/** A Drive v3 call failed with an HTTP error after the retry policy ran. */
export class DriveApiError extends AppError {
  constructor(
    message: string,
    public readonly status: number,
    reason?: string,
  ) {
    super(message, {
      code: 'DRIVE_API_ERROR',
      context: { status, reason },
      retryable: status === 429 || status >= 500,
    });
    this.name = 'DriveApiError';
  }
}

/**
 * A ranged download (`Range: bytes=…`) came back `200 OK` instead of
 * `206 Partial Content`: the server (or an intermediary) ignored the Range
 * header and would stream the whole file. The range client cancels the body
 * and throws this so callers can fall back to a full download (or skip the
 * preview) rather than silently buffering megabytes.
 */
export class DriveRangeUnsupportedError extends AppError {
  constructor(public readonly fileId: string) {
    super('Drive ignored the Range header (got 200, expected 206).', {
      code: 'DRIVE_RANGE_UNSUPPORTED',
      context: { fileId },
    });
    this.name = 'DriveRangeUnsupportedError';
  }
}

/**
 * Boundary mapping helper: rethrows already-typed AppErrors (incl. the
 * GOOGLE_AUTH_* family and the gateway's NET_*), wraps everything else as
 * DRIVE_UNKNOWN with the raw error attached as cause.
 */
export function handleDriveError(error: unknown, operation: string): never {
  if (error instanceof AppError) throw error;
  throw new AppError(`Drive ${operation} failed.`, {
    code: 'DRIVE_UNKNOWN',
    cause: error,
    context: { operation },
  });
}
