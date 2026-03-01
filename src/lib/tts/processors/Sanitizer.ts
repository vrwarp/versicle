import { RegexPatterns } from './RegexPatterns';

/**
 * Sanitizes text by removing or replacing non-narrative artifacts.
 */
export class Sanitizer {
    // Pre-compile global regexes to avoid instantiation overhead per sanitize call
    private static readonly RE_URL_GLOBAL = new RegExp(RegexPatterns.URL, 'g');
    private static readonly RE_CITATION_NUMERIC_GLOBAL = new RegExp(RegexPatterns.CITATION_NUMERIC, 'g');
    private static readonly RE_CITATION_AUTHOR_YEAR_GLOBAL = new RegExp(RegexPatterns.CITATION_AUTHOR_YEAR, 'g');
    private static readonly RE_MULTIPLE_SPACES_GLOBAL = new RegExp(RegexPatterns.MULTIPLE_SPACES, 'g');
    private static readonly RE_SPACE_BEFORE_PUNCTUATION = /\s+([.,!?;:])/g;

    /**
     * Sanitizes the input text.
     * @param text The raw text to sanitize.
     * @returns The sanitized text.
     */
    static sanitize(text: string): string {
        if (!text) return text;

        let processed = text;

        // 1. Remove Page Numbers (if the text is JUST a page number or very short line)
        // We generally process chunks of text, so we need to be careful.
        // If the segment is just a page number, return empty string.
        if (RegexPatterns.PAGE_NUMBER.test(processed)) {
            return '';
        }

        // 2. Replace URLs with just the domain
        // We use a loop or replace with callback to handle multiple URLs
        // The regex captures the domain in group 1.
        // We use the 'g' flag equivalent by constructing a new RegExp or using replaceAll if the pattern was global.
        // Since our pattern in RegexPatterns isn't global, we can use split/join or a loop.
        // But to be safe and efficient, let's make a local global regex.

        // OPTIMIZATION: Only run URL regex if 'http' or 'www' is present.
        // This avoids expensive regex scans on 99% of sentences that don't contain URLs.
        if (processed.includes('http') || processed.includes('www.')) {
            processed = processed.replace(Sanitizer.RE_URL_GLOBAL, (match, domain) => {
                // Check for unbalanced trailing parentheses
                if (match.endsWith(')')) {
                    const openCount = (match.match(/\(/g) || []).length;
                    const closeCount = (match.match(/\)/g) || []).length;
                    if (closeCount > openCount) {
                        // Assume the last ')' is a closing punctuation mark, not part of the URL
                        return domain + ')';
                    }
                }
                return domain;
            });
        }

        // 3. Remove Citations

        // OPTIMIZATION: Only check for numeric citations if bracket is present.
        if (processed.includes('[')) {
            processed = processed.replace(Sanitizer.RE_CITATION_NUMERIC_GLOBAL, '');
        }

        // OPTIMIZATION: Only check for author-year citations if parenthesis is present.
        if (processed.includes('(')) {
            processed = processed.replace(Sanitizer.RE_CITATION_AUTHOR_YEAR_GLOBAL, '');
        }

        // 4. Handle Visual Separators
        // If the text is just a separator, we might return a pause or empty string.
        if (RegexPatterns.SEPARATOR.test(processed)) {
            // For now, return empty. The TTS engine handles silence for empty segments or we can inject a pause later.
            return '';
        }

        // 5. Clean up extra spaces introduced by removals
        processed = processed.replace(Sanitizer.RE_MULTIPLE_SPACES_GLOBAL, ' ').trim();

        // 6. Clean up spaces before punctuation (often left when inline citations are removed)
        processed = processed.replace(Sanitizer.RE_SPACE_BEFORE_PUNCTUATION, '$1');

        return processed;
    }
}
