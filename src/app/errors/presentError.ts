/**
 * presentError — the ONE error→user-message mapper (C10; type-safety-errors
 * convention: UI maps `error.code`, never relays raw `message` prose from
 * services). en-only per docs/adr/0001-i18n-strategy.md; when the message
 * catalog lands (P8 choke points), this switch becomes a catalog lookup
 * keyed `errors.<code>`.
 */
import { AppError } from '~types/errors';

const MESSAGES: Partial<Record<string, string>> = {
  INGEST_DUPLICATE_BOOK: 'This book is already in your library.',
  INGEST_INVALID_FILE: 'That file is not a valid EPUB.',
  INGEST_FILE_MISMATCH: "That file doesn't match this book's original content.",
  INGEST_CANCELLED: 'Import cancelled.',
  INGEST_UNKNOWN: 'Failed to import book.',
  DB_QUOTA_EXCEEDED: 'Device storage full. Please delete some books.',
  SEARCH_SESSION_DISPOSED: 'Search was interrupted. Try again.',
  SEARCH_UNKNOWN: 'Search failed. Try again.',
  NET_OFFLINE: 'You appear to be offline.',
  NET_TIMEOUT: 'The request timed out. Try again.',
};

const FALLBACK = 'Something went wrong. Please try again.';

/** Map any thrown value to a user-presentable message (UI/toast boundary). */
export function presentError(error: unknown): string {
  if (error instanceof AppError) {
    return MESSAGES[error.code] ?? FALLBACK;
  }
  return FALLBACK;
}
