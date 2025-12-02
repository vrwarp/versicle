/**
 * Regular expression patterns for text sanitization.
 * Used to remove or replace non-narrative artifacts from text.
 */
export const RegexPatterns = {
    // Matches standalone page numbers (e.g., "12", "Page 12", "pg. 12") on a line by themselves
    PAGE_NUMBER: /^\s*(?:(?:page|pg\.?)\s*)?\d+\s*$/i,

    // Matches URLs, capturing the domain.
    // Group 1: Protocol (optional)
    // Group 2: Domain (required)
    // Group 3: Path/Query (optional)
    URL: /https?:\/\/(?:www\.)?([-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9]{1,63})\b(?:[-a-zA-Z0-9()@:%_+.~#?&//=]*[^.,?!:;"'\s])?/,

    // Matches academic citations like [1], [12], (Author, 2020)
    // Simple numeric citations: \[ \d+ \]
    CITATION_NUMERIC: /\[\s*\d+(?:\s*,\s*\d+)*\s*\]/,

    // Parenthetical citations are harder to distinguish from normal text.
    // We'll target specific common patterns like (Name, Year) or (Name Year)
    // careful not to match "(He said hello)"
    CITATION_AUTHOR_YEAR: /\([A-Z][a-zA-Z\s]+,?\s+\d{4}(?::\d+)?\)/,

    // Visual separators like ***, ---, ___
    SEPARATOR: /^\s*[-*_]{3,}\s*$/,

    // Multiple spaces
    MULTIPLE_SPACES: /\s{2,}/
};
