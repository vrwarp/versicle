/**
 * Entity Resolution Utilities
 *
 * Provides deterministic normalization for matching ReadingListEntry records
 * to UserInventoryItem records when the primary key (filename) lookup fails.
 *
 * The normalization pipeline neutralizes structural discrepancies inherent in
 * e-book metadata: file extensions in titles, snake_case, edition tags in
 * brackets, inconsistent punctuation, and generic author strings.
 */

/**
 * Normalizes a metadata string (title or author) for fuzzy comparison.
 *
 * Pipeline (order matters):
 * 1. Lowercase
 * 2. Strip trailing file extensions (.epub, .pdf, .mobi, .azw3)
 * 3. Remove parenthetical/bracketed metadata (e.g. "[Deluxe Edition]", "(2nd ed.)")
 * 4. Replace structural punctuation (- _ : , .) with spaces
 * 5. Remove quotes and apostrophes entirely
 * 6. Collapse whitespace and trim
 * 7. Nullify generic "unknown author" strings
 */
export function normalizeMetadata(text: string): string {
    if (!text) return "";

    let normalized = text.toLowerCase();

    // 1. Strip file extensions at the end of the string
    normalized = normalized.replace(/\.(epub|pdf|mobi|azw3)$/i, "");

    // 2. Remove parenthetical or bracketed metadata
    normalized = normalized.replace(/\(.*?\)|\[.*?\]/g, "");

    // 3. Replace structural punctuation with spaces
    normalized = normalized.replace(/[-_:,.]/g, " ");

    // 4. Remove possessives and quotes entirely
    normalized = normalized.replace(/['"''""\u2018\u2019\u201C\u201D]/g, "");

    // 5. Collapse and trim whitespace
    normalized = normalized.replace(/\s+/g, " ").trim();

    // 6. Strip trailing contributor role suffixes (e.g. "gen. ed." → "gen ed" after punct removal)
    normalized = normalized.replace(/\b(?:gen ed|eds?|trans|illus|fwd|intro|comp|narr)$/, "").trim();

    // 7. Nullify generic author strings
    if (normalized === "unknown author") {
        return "";
    }

    return normalized;
}

/**
 * Generates a composite match key from a title and author.
 * Used to compare entries across different data stores.
 *
 * Includes a heuristic to strip author-name prefixes from titles,
 * which is common in filename-derived metadata (e.g. "Author - Title.epub").
 *
 * @returns A normalized, collapsed string: "normalizedtitle normalizedauthor"
 */
export function generateMatchKey(title: string, author: string): string {
    let normTitle = normalizeMetadata(title);
    const normAuthor = normalizeMetadata(author);

    // Strip author prefix from title if present (common filename pattern: "Author - Title.epub")
    // e.g. "francis chan crazy love" with author "francis chan" → "crazy love"
    if (normAuthor && normTitle.startsWith(normAuthor + " ")) {
        normTitle = normTitle.slice(normAuthor.length).trim();
    }
    return `${normTitle} ${normAuthor}`.replace(/\s+/g, " ").trim();
}
