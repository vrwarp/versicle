import { REGEX_PATTERNS } from './RegexPatterns';

/**
 * Sanitizes text by removing or replacing unwanted artifacts like
 * page numbers, URLs, and citations.
 */
export class Sanitizer {
  /**
   * Cleans the input text based on the defined regex patterns.
   * @param text The raw text to sanitize.
   * @returns The sanitized text.
   */
  static sanitize(text: string): string {
    if (!text) return text;

    let cleanText = text;

    // Replace URLs with hostname
    cleanText = cleanText.replace(REGEX_PATTERNS.URL, (match) => {
        try {
            // Ensure protocol exists for parsing
            const urlToParse = match.startsWith('http') ? match : `http://${match}`;
            const url = new URL(urlToParse);
            return ` ${url.hostname} `;
        } catch {
            return ' '; // Fallback if parsing fails
        }
    });

    // Remove Bracket Citations [1]
    cleanText = cleanText.replace(REGEX_PATTERNS.CITATION_BRACKETS, '');

    // Remove Parenthetical Citations (Smith, 2020)
    cleanText = cleanText.replace(REGEX_PATTERNS.CITATION_PARENS, '');

    // Process line-based patterns (Page numbers, Separators)
    const lines = cleanText.split('\n');
    const processedLines = lines.map(line => {
        // Check for page number line
        if (REGEX_PATTERNS.PAGE_NUMBER_LINE.test(line)) {
            return ''; // Remove the line completely
        }

        // Check for visual separators
        if (REGEX_PATTERNS.VISUAL_SEPARATOR.test(line)) {
            return '';
        }

        return line;
    });

    // Remove empty lines created by sanitization (optional, but good for cleanliness)
    // We filter out lines that are purely whitespace after processing
    const nonEmptyLines = processedLines.filter(line => line.trim().length > 0);

    // Join back with newlines
    // And collapse multiple horizontal spaces within each line
    cleanText = nonEmptyLines
        .map(line => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n');

    return cleanText;
  }
}
