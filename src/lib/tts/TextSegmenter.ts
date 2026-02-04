import { tryFastMergeCfi, mergeCfiSlow } from '../cfi-utils';
import type { SentenceNode } from '../tts';
import { getCachedSegmenter } from './segmenter-cache';

/**
 * Represents a segment of text (e.g., a sentence) with its location.
 */
export interface TextSegment {
    /** The text content of the segment. */
    text: string;
    /** The start index of the segment in the original text. */
    index: number;
    /** The length of the segment. */
    length: number;
}

/**
 * Abbreviations that are almost exclusively titles and should always trigger a merge
 * regardless of the next word.
 */
export const DEFAULT_ALWAYS_MERGE = ['Mr.', 'Mrs.', 'Ms.', 'Prof.', 'Gen.', 'Rep.', 'Sen.'];

/**
 * Words that strongly indicate the start of a new sentence.
 * If the next segment starts with one of these, we should not merge,
 * even if the previous segment ended with an ambiguous abbreviation (like "Dr.").
 */
export const DEFAULT_SENTENCE_STARTERS = [
    'He', 'She', 'It', 'They', 'We', 'You', 'I',
    'The', 'A', 'An', 'This', 'That', 'These', 'Those',
    'Here', 'There', 'Where', 'When', 'Why', 'How',
    'But', 'And', 'Or', 'So', 'Then',
    // Contractions and Interrogatives
    "It's", "He's", "She's", "That's", "There's", "Here's",
    "I'm", "You're", "We're", "They're",
    "What", "Who", "What's", "Who's"
];

// Pre-compiled regexes for performance

// Matches the last sequence of non-whitespace characters in a string.
// \S+ = one or more non-whitespace characters
// $ = end of string
// Used to identify the last word of a sentence segment to check for abbreviations.
export const RE_LAST_WORD = /\S+$/;

// Matches the last two whitespace-separated words in a string.
// (?:...) = non-capturing group for the first word and its trailing space
// \S+\s+ = one or more non-whitespace chars followed by one or more whitespace chars
// \S+$ = the final word (non-whitespace) at the end of the string
// Used to identify multi-word abbreviations like "et al." at the end of a segment.
export const RE_LAST_TWO_WORDS = /(?:\S+\s+)\S+$/;

// Matches the first sequence of non-whitespace characters in a string.
// ^ = start of string
// \S+ = one or more non-whitespace characters
// Used to identify the first word of the next segment to check against sentence starters.
export const RE_FIRST_WORD = /^\S+/;

// Matches common opening punctuation marks (quotes, brackets, etc.) at the start of a string.
// ^ = start of string
// ['"([<{]+ = one or more characters from the set of opening punctuation
// Used to strip punctuation before checking if a word is a sentence starter.
export const RE_LEADING_PUNCTUATION = /^['"([<{]+/;

// Matches sentence-ending punctuation marks (.,!?;:) at the end of a string.
// [.,!?;:] = character class containing common sentence delimiters
// $ = end of string
// Used to clean the next word before checking if it's a starter.
export const RE_TRAILING_PUNCTUATION = /[.,!?;:]$/;

// Fallback sentence splitting regex.
// Captures sequences of characters ending with sentence-ending punctuation (.!?).
// ([^.!?]+[.!?]+) = Capture group 1:
//   [^.!?]+ = one or more characters that are NOT sentence-ending punctuation
//   [.!?]+ = one or more sentence-ending punctuation characters
// /g = global flag to find all matches
// Used when Intl.Segmenter is not available.
export const RE_SENTENCE_FALLBACK = /([^.!?]+[.!?]+)/g;

interface TrieNode {
    [key: string]: TrieNode | boolean | undefined;
    _end?: boolean;
}

/**
 * A specialized Trie implementation for fast string matching without allocations.
 * Optimized for case-insensitive matching.
 */
class Trie {
    private root: TrieNode = {};

    /**
     * Inserts a string into the Trie.
     * @param text - The text to insert.
     * @param reverse - Whether to insert the text in reverse order (for suffix matching).
     */
    insert(text: string, reverse: boolean = false) {
        const normalized = text.normalize('NFKD');
        let node = this.root;
        const len = normalized.length;

        if (reverse) {
            for (let i = len - 1; i >= 0; i--) {
                const char = normalized[i].toLowerCase();
                if (!node[char]) {
                    node[char] = {};
                }
                node = node[char] as TrieNode;
            }
        } else {
            for (let i = 0; i < len; i++) {
                const char = normalized[i].toLowerCase();
                if (!node[char]) {
                    node[char] = {};
                }
                node = node[char] as TrieNode;
            }
        }
        node._end = true;
    }

    /**
     * Checks if the text ends with any string in the Trie.
     * Scans backwards from the end of the text, skipping trailing whitespace.
     *
     * @param text - The text to check.
     * @returns The matching word if found, or null.
     */
    matchesEnd(text: string): string | null {
        let i = text.length - 1;
        // Skip trailing whitespace
        while (i >= 0 && TextSegmenter.isWhitespace(text.charCodeAt(i))) {
            i--;
        }
        if (i < 0) return null;

        let node = this.root;
        const startScan = i;
        let lastMatch: string | null = null;

        // Scan backwards through the text
        while (i >= 0) {
            const char = text[i].toLowerCase();
            if (!node[char]) {
                break;
            }
            node = node[char] as TrieNode;

            // If we found a potential match in the Trie
            if (node._end) {
                // Verify boundary: Previous char must be Punctuation, Whitespace, or Start
                const prevIndex = i - 1;
                const isBoundary = prevIndex < 0 ||
                                   TextSegmenter.isWhitespace(text.charCodeAt(prevIndex)) ||
                                   TextSegmenter.isPunctuation(text.charCodeAt(prevIndex));

                if (isBoundary) {
                    // Valid match found.
                    // Note: We continue scanning to find the *longest* match if needed?
                    // "et al." vs "al.".
                    // If text is "et al.", we match "." -> "l" -> "a" -> " " -> "t" -> "e".
                    // If we stopped at "al.", we might miss "et al.".
                    // So we record this match but keep going.
                    lastMatch = text.substring(i, startScan + 1);
                }
            }
            i--;
        }

        return lastMatch;
    }

    /**
     * Checks if the text starts with any string in the Trie.
     * Scans forward from the start of the text, skipping leading whitespace.
     *
     * @param text - The text to check.
     * @returns The matching word if found, or null.
     */
    matchesStart(text: string): boolean {
        let i = 0;
        const len = text.length;
        // Skip leading whitespace
        while (i < len && TextSegmenter.isWhitespace(text.charCodeAt(i))) {
            i++;
        }
        if (i >= len) return false;

        let node = this.root;

        // Scan forward
        while (i < len) {
            const char = text[i].toLowerCase();
            if (!node[char]) {
                return false; // No path
            }
            node = node[char] as TrieNode;

            if (node._end) {
                // Verify boundary: Next char must be Punctuation, Whitespace, or End
                const nextIndex = i + 1;
                const isBoundary = nextIndex >= len ||
                                   TextSegmenter.isWhitespace(text.charCodeAt(nextIndex)) ||
                                   TextSegmenter.isPunctuation(text.charCodeAt(nextIndex));

                if (isBoundary) {
                    return true;
                }
            }
            i++;
        }
        return false;
    }
}

/**
 * Robust text segmentation utility using Intl.Segmenter with fallback and post-processing.
 * Handles edge cases like abbreviations (e.g., "Mr.", "i.e.") to prevent incorrect sentence splitting.
 */
export class TextSegmenter {
    private segmenter: Intl.Segmenter | undefined;

    // Static cache for refined segments options
    private static cache = {
        abbreviations: [] as string[],
        abbrTrie: new Trie(),
        alwaysMerge: [] as string[],
        mergeTrie: new Trie(),
        sentenceStarters: [] as string[],
        starterTrie: new Trie()
    };

    /**
     * Initializes the TextSegmenter.
     *
     * @param locale - The locale for Intl.Segmenter (default 'en').
     */
    constructor(locale: string = 'en') {
        this.segmenter = getCachedSegmenter(locale);
    }

    /**
     * Segments a text string into sentences or logical units.
     *
     * @param text - The text to segment.
     * @returns An array of TextSegment objects.
     */
    segment(text: string): TextSegment[] {
        if (!text) return [];
        const normalizedText = text.normalize('NFKD');

        if (this.segmenter) {
            return Array.from(this.segmenter.segment(normalizedText)).map(s => ({
                text: s.segment,
                index: s.index,
                length: s.segment.length
            }));
        }

        return this.fallbackSegment(normalizedText);
    }

    /**
     * Checks if a character code represents a whitespace character.
     * Covers common ASCII and Unicode whitespace to match Regex `\s`.
     */
    public static isWhitespace(code: number): boolean {
        return (code === 0x0020) || // Space
            (code >= 0x0009 && code <= 0x000D) || // Tab, LF, VT, FF, CR
            (code === 0x00A0) || // NBSP
            (code === 0x1680) || // Ogham Space Mark
            (code >= 0x2000 && code <= 0x200A) || // U+2000-U+200A (En Quad...Hair Space)
            (code === 0x2028) || (code === 0x2029) || // Line/Para Separator
            (code === 0x202F) || // Narrow No-Break Space
            (code === 0x205F) || // Medium Mathematical Space
            (code === 0x3000) || // Ideographic Space
            (code === 0xFEFF); // BOM
    }

    private static readonly CODE_QUOTE_DOUBLE = '"'.codePointAt(0)!;
    private static readonly CODE_QUOTE_SINGLE = "'".codePointAt(0)!;
    private static readonly CODE_PAREN_OPEN = '('.codePointAt(0)!;
    private static readonly CODE_PAREN_CLOSE = ')'.codePointAt(0)!;
    private static readonly CODE_BRACKET_OPEN = '['.codePointAt(0)!;
    private static readonly CODE_BRACKET_CLOSE = ']'.codePointAt(0)!;
    private static readonly CODE_ANGLE_OPEN = '<'.codePointAt(0)!;
    private static readonly CODE_ANGLE_CLOSE = '>'.codePointAt(0)!;
    private static readonly CODE_BRACE_OPEN = '{'.codePointAt(0)!;
    private static readonly CODE_BRACE_CLOSE = '}'.codePointAt(0)!;
    private static readonly CODE_PERIOD = '.'.codePointAt(0)!;
    private static readonly CODE_COMMA = ','.codePointAt(0)!;
    private static readonly CODE_EXCLAMATION = '!'.codePointAt(0)!;
    private static readonly CODE_QUESTION = '?'.codePointAt(0)!;
    private static readonly CODE_SEMICOLON = ';'.codePointAt(0)!;
    private static readonly CODE_COLON = ':'.codePointAt(0)!;

    /**
     * Checks if a character code represents a common punctuation mark to strip.
     * Includes quotes, brackets, and sentence delimiters.
     */
    public static isPunctuation(code: number): boolean {
        return (code === TextSegmenter.CODE_QUOTE_DOUBLE) || (code === TextSegmenter.CODE_QUOTE_SINGLE) ||
            (code === TextSegmenter.CODE_PAREN_OPEN) || (code === TextSegmenter.CODE_PAREN_CLOSE) ||
            (code === TextSegmenter.CODE_BRACKET_OPEN) || (code === TextSegmenter.CODE_BRACKET_CLOSE) ||
            (code === TextSegmenter.CODE_ANGLE_OPEN) || (code === TextSegmenter.CODE_ANGLE_CLOSE) ||
            (code === TextSegmenter.CODE_BRACE_OPEN) || (code === TextSegmenter.CODE_BRACE_CLOSE) ||
            (code === TextSegmenter.CODE_PERIOD) || (code === TextSegmenter.CODE_COMMA) ||
            (code === TextSegmenter.CODE_EXCLAMATION) || (code === TextSegmenter.CODE_QUESTION) ||
            (code === TextSegmenter.CODE_SEMICOLON) || (code === TextSegmenter.CODE_COLON);
    }

    /**
     * Helper to merge two text strings with appropriate separation.
     * Uses manual scanning to avoid expensive trimEnd() and regex allocations.
     */
    private static mergeText(left: string, right: string): string {
        let i = left.length - 1;
        // Check for whitespace (Space, NBSP, Tab, LF, CR)
        while (i >= 0 && (left.charCodeAt(i) === 32 || left.charCodeAt(i) === 160 || left.charCodeAt(i) === 9 || left.charCodeAt(i) === 10 || left.charCodeAt(i) === 13)) {
            i--;
        }

        let separator = '. ';
        if (i >= 0) {
            const code = left.charCodeAt(i);
            // Check for punctuation: . , ! ? ; :
            if (code === 46 || code === 44 || code === 33 || code === 63 || code === 59 || code === 58) {
                separator = ' ';
            }
            return left.substring(0, i + 1) + separator + right;
        } else {
            // Left was empty or all whitespace
            return separator + right;
        }
    }

    /**
     * Fallback segmentation logic using simple regex if Intl.Segmenter is unavailable.
     *
     * @param text - The text to segment.
     * @returns An array of TextSegment objects.
     */
    private fallbackSegment(text: string): TextSegment[] {
        const sentences: TextSegment[] = [];
        let match;
        let lastIndex = 0;

        // Reset regex state
        RE_SENTENCE_FALLBACK.lastIndex = 0;

        while ((match = RE_SENTENCE_FALLBACK.exec(text)) !== null) {
            sentences.push({
                text: match[0],
                index: match.index,
                length: match[0].length
            });
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
            const remaining = text.substring(lastIndex);
            if (remaining.trim().length > 0) {
                sentences.push({
                    text: remaining,
                    index: lastIndex,
                    length: remaining.length
                });
            }
        }
        return sentences;
    }

    /**
     * Dynamically refines a list of sentences by merging them based on current abbreviation settings.
     * This allows for reactive segmentation (changing abbreviations without re-ingesting).
     *
     * @param sentences - The list of sentences to refine.
     * @param abbreviations - Current list of abbreviations.
     * @param alwaysMerge - List of abbreviations that always force a merge.
     * @param sentenceStarters - List of words that prevent a merge.
     * @param minSentenceLength - Minimum characters for a sentence (optional).
     * @returns A new list of refined (merged) sentences.
     */
    public static refineSegments(
        sentences: SentenceNode[],
        abbreviations: string[],
        alwaysMerge: string[],
        sentenceStarters: string[],
        minSentenceLength: number = 0
    ): SentenceNode[] {
        if (!sentences || sentences.length === 0) return [];

        const merged: SentenceNode[] = [];

        // Check cache for abbreviations
        if (TextSegmenter.cache.abbreviations !== abbreviations) {
            TextSegmenter.cache.abbreviations = abbreviations;
            const trie = new Trie();
            abbreviations.forEach(s => trie.insert(s, true)); // Insert reversed
            TextSegmenter.cache.abbrTrie = trie;
        }
        const abbrTrie = TextSegmenter.cache.abbrTrie;

        // Check cache for alwaysMerge
        if (TextSegmenter.cache.alwaysMerge !== alwaysMerge) {
            TextSegmenter.cache.alwaysMerge = alwaysMerge;
            const trie = new Trie();
            alwaysMerge.forEach(s => trie.insert(s, true)); // Insert reversed
            TextSegmenter.cache.mergeTrie = trie;
        }
        const mergeTrie = TextSegmenter.cache.mergeTrie;

        // Check cache for sentenceStarters
        if (TextSegmenter.cache.sentenceStarters !== sentenceStarters) {
            TextSegmenter.cache.sentenceStarters = sentenceStarters;
            const trie = new Trie();
            sentenceStarters.forEach(s => trie.insert(s, false)); // Insert forward
            TextSegmenter.cache.starterTrie = trie;
        }
        const starterTrie = TextSegmenter.cache.starterTrie;

        for (let i = 0; i < sentences.length; i++) {
            // Optimization: Assume sentences are already normalized by TextSegmenter.segment() during ingestion.
            // Avoiding re-normalization improves performance significantly.

            // Optimization: Delay cloning. We only clone if we are pushing to 'merged' to start a new segment.
            // If we merge into the previous segment, we read from 'current' (immutable in this context)
            // and write to 'last' (already cloned/created).
            const current = sentences[i];

            if (merged.length > 0) {
                const last = merged[merged.length - 1];

                // Check if last segment ends with an abbreviation
                // OPTIMIZATION: Use Trie scan to avoid substring allocation and lowercasing
                const matchedAbbr = abbrTrie.matchesEnd(last.text);

                if (matchedAbbr) {
                    let shouldMerge = false;

                    // Check if the abbreviation is in the alwaysMerge list
                    // Since mergeTrie is a subset of abbrTrie (usually), we check the matched string
                    // Note: mergeTrie is also a Trie, so we can check if the *found match* is in it.
                    // Or cleaner: scan last.text with mergeTrie as well?
                    // To avoid double scan: we have the matched string. Check if that string is in alwaysMerge set?
                    // But we replaced Sets with Tries.
                    // Actually, re-scanning with mergeTrie is cheap (it's short).
                    // Or: We could merge the Tries?
                    // For now, simpler to just scan again or check membership.
                    // Since we have the exact text of the abbreviation, we can just check if mergeTrie has it?
                    // matchesEnd returns the matched string.
                    // We can check `mergeTrie.matchesEnd(last.text)`.
                    // But wait, if `abbrTrie` matched "Mr.", `mergeTrie` should also match "Mr.".
                    // Let's just use mergeTrie.matchesEnd(last.text).

                    if (mergeTrie.matchesEnd(last.text)) {
                        shouldMerge = true;
                    } else {
                        // Check the next segment (current)
                        // OPTIMIZATION: Use Trie scan to avoid substring allocation
                        if (!starterTrie.matchesStart(current.text)) {
                            shouldMerge = true;
                        }
                    }

                    if (shouldMerge) {
                        // Merge current into last
                        last.text += (last.text.endsWith(' ') ? '' : ' ') + current.text;

                        // Merge CFIs
                        // Optimization: Try fast path first
                        const fastMergedCfi = tryFastMergeCfi(last.cfi, current.cfi);
                        if (fastMergedCfi) {
                            last.cfi = fastMergedCfi;
                        } else {
                            const slowMergedCfi = mergeCfiSlow(last.cfi, current.cfi);
                            if (slowMergedCfi) {
                                last.cfi = slowMergedCfi;
                            }
                        }

                        // Merge Source Indices
                        if (current.sourceIndices) {
                            last.sourceIndices = (last.sourceIndices || []).concat(current.sourceIndices);
                        }

                        continue;
                    }
                }
            }

            // Not merged, start new segment (clone to separate from input)
            merged.push({ ...current });
        }

        if (minSentenceLength <= 0) {
            return merged;
        }

        return this.mergeByLength(merged, minSentenceLength);
    }

    /**
     * Merges sentences that are shorter than the minimum length with adjacent sentences.
     *
     * @param sentences - The list of sentences to merge.
     * @param minLength - The minimum character length.
     * @returns A new list of merged sentences.
     */
    public static mergeByLength(sentences: SentenceNode[], minLength: number): SentenceNode[] {
        if (!sentences || sentences.length === 0) return [];

        const lengthMerged: SentenceNode[] = [];
        let buffer: SentenceNode | null = null;

        for (let i = 0; i < sentences.length; i++) {
            const current = sentences[i];

            if (!buffer) {
                buffer = { ...current };
                continue;
            }

            // Check if buffer is too short
            if (buffer.text.length < minLength) {
                // Merge current into buffer
                buffer.text = TextSegmenter.mergeText(buffer.text, current.text);

                // Merge CFIs
                const fastMergedCfi = tryFastMergeCfi(buffer.cfi, current.cfi);
                if (fastMergedCfi) {
                    buffer.cfi = fastMergedCfi;
                } else {
                    const slowMergedCfi = mergeCfiSlow(buffer.cfi, current.cfi);
                    if (slowMergedCfi) {
                        buffer.cfi = slowMergedCfi;
                    }
                }

                // Merge Source Indices
                if (current.sourceIndices) {
                    buffer.sourceIndices = (buffer.sourceIndices || []).concat(current.sourceIndices);
                }
            } else {
                lengthMerged.push(buffer);
                buffer = { ...current };
            }
        }

        if (buffer) {
            // Handle last item: if it's still short, try to merge it BACK into the last pushed item
            if (buffer.text.length < minLength && lengthMerged.length > 0) {
                const last = lengthMerged[lengthMerged.length - 1];

                last.text = TextSegmenter.mergeText(last.text, buffer.text);

                const fastMergedCfi = tryFastMergeCfi(last.cfi, buffer.cfi);
                if (fastMergedCfi) {
                    last.cfi = fastMergedCfi;
                } else {
                    const slowMergedCfi = mergeCfiSlow(last.cfi, buffer.cfi);
                    if (slowMergedCfi) {
                        last.cfi = slowMergedCfi;
                    }
                }

                // Merge Source Indices
                if (buffer.sourceIndices) {
                    last.sourceIndices = (last.sourceIndices || []).concat(buffer.sourceIndices);
                }
            } else {
                lengthMerged.push(buffer);
            }
        }

        return lengthMerged;
    }
}
