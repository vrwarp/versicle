/**
 * The current version of the book ingestion pipeline.
 * Incrementing this will trigger reprocessing for books with older versions.
 *
 * Version History:
 * 1: Initial version with table image processing.
 * 6: Added some other extraction features.
 * 7: Skip typical citation markers during TTS extraction.
 */
export const CURRENT_BOOK_VERSION = 7;
