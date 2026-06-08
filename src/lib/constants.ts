/**
 * The current version of the book ingestion pipeline.
 * Incrementing this will trigger reprocessing for books with older versions.
 *
 * Version History:
 * 1: Initial version with table image processing.
 * 6: Added some other extraction features.
 * 7: Skip typical citation markers during TTS extraction.
 * 8: Use Point CFIs for tables instead of broken Range CFIs.
 * 9: Skip structural metadata tags during sentence extraction.
 * 10: Capture citation markers as sidecar during extraction (citation-aware reference detection).
 * 11: Record leading flag on citation markers (note/endnote entries that open with an anchor).
 */
export const CURRENT_BOOK_VERSION = 11;
