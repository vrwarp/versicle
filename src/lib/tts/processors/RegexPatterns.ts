
/**
 * Repository of regular expressions for text sanitization.
 *
 * This file contains patterns to identify and remove or replace:
 * - Page numbers (e.g., "Page 42", plain digits on a line)
 * - URLs (http/https)
 * - Academic citations (e.g., "[12]", "(Smith, 2020)")
 * - Visual separators (e.g., "* * *", "---")
 */

export const REGEX_PATTERNS = {
    // Matches lines that are just digits, optionally wrapped in whitespace
    // or "Page" followed by digits
    PAGE_NUMBER_LINE: /^\s*(?:Page\s+)?\d+\s*$/i,

    // Standard URL pattern (http/https/www)
    // Updated to match more complex TLDs and paths, using a more inclusive pattern for the path part
    // Note: This regex is still heuristic.
    URL: /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,63}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,

    // Academic citations:
    // 1. Bracket style: [12], [12-14]
    CITATION_BRACKETS: /\[\d+(?:[-–,]\s*\d+)*\]/g,

    // 2. Parentheses style is tricky as it can match normal text.
    // We'll target specific academic patterns: (Name, Year) or (Name et al., Year)
    // This is conservative to avoid removing "(He went home, 1990)" which is unlikely but possible narrative.
    // Matches: (Smith, 2020), (Smith et al., 2020), (Smith & Jones, 2020)
    CITATION_PARENS: /\([A-Z][a-zA-Z]+(?: (?:et al\.|& [A-Z][a-zA-Z]+))?, \d{4}(?:;.*)?\)/g,

    // Visual separators:
    // Matches lines containing only repeated punctuation/symbols typically used for breaks
    // e.g. ***, ---, * * *, - - -
    VISUAL_SEPARATOR: /^\s*(?:[\*\-_~]\s*){3,}\s*$/m,
  };
