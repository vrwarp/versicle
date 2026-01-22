import { createLogger } from '../logger';

const logger = createLogger('TextMatching');

/**
 * Utility functions for fuzzy text matching.
 */

/**
 * Finds the position of a substring in a text, ignoring case and whitespace differences.
 * Use this to locate text snippets returned by the LLM in the original content.
 *
 * @param text The full text to search in.
 * @param query The text to find.
 * @returns The start and end indices in the original text, or null if not found.
 */
export function findApproximateMatch(text: string, query: string): { start: number; end: number } | null {
    if (!query || !text) return null;

    // 1. Exact match
    const exactIdx = text.indexOf(query);
    if (exactIdx !== -1) return { start: exactIdx, end: exactIdx + query.length };

    // 2. Case-insensitive match
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const caseIdx = lowerText.indexOf(lowerQuery);
    if (caseIdx !== -1) return { start: caseIdx, end: caseIdx + query.length };

    // 3. Flexible whitespace match
    // Construct a regex that allows variable whitespace
    try {
        // Escape regex special characters
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Replace explicit whitespace in query with \s+ to match any whitespace sequence
        // also allow optional whitespace around punctuation
        const regexPattern = escapedQuery.replace(/\s+/g, '\\s+');

        const regex = new RegExp(regexPattern, 'i'); // Case insensitive
        const match = regex.exec(text);
        if (match) {
            return { start: match.index, end: match.index + match[0].length };
        }
    } catch (e) {
        logger.warn('Regex matching failed for query:', query, e);
    }

    return null;
}
