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

// Optimized regexes for trim-less operations in refineSegments
// These capture the relevant part in group 1, ignoring surrounding whitespace.
const RE_LAST_WORD_TRIMLESS = /(\S+)\s*$/;
const RE_LAST_TWO_WORDS_TRIMLESS = /((?:\S+\s+)\S+)\s*$/;
const RE_FIRST_WORD_TRIMLESS = /^\s*(\S+)/;

/**
 * Robust text segmentation utility using Intl.Segmenter with fallback and post-processing.
 * Handles edge cases like abbreviations (e.g., "Mr.", "i.e.") to prevent incorrect sentence splitting.
 */
export class TextSegmenter {
    private segmenter: Intl.Segmenter | undefined;

    // Static cache for refined segments options
    private static cache = {
        abbreviations: [] as string[],
        abbrSet: new Set<string>(),
        alwaysMerge: [] as string[],
        mergeSet: new Set<string>(),
        sentenceStarters: [] as string[],
        starterSet: new Set<string>()
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
            TextSegmenter.cache.abbrSet = new Set(abbreviations.map(s => s.normalize('NFKD').toLowerCase()));
        }
        const abbrSet = TextSegmenter.cache.abbrSet;

        // Check cache for alwaysMerge
        if (TextSegmenter.cache.alwaysMerge !== alwaysMerge) {
            TextSegmenter.cache.alwaysMerge = alwaysMerge;
            TextSegmenter.cache.mergeSet = new Set(alwaysMerge.map(s => s.normalize('NFKD').toLowerCase()));
        }
        const mergeSet = TextSegmenter.cache.mergeSet;

        // Check cache for sentenceStarters
        if (TextSegmenter.cache.sentenceStarters !== sentenceStarters) {
            TextSegmenter.cache.sentenceStarters = sentenceStarters;
            TextSegmenter.cache.starterSet = new Set(sentenceStarters.map(s => s.normalize('NFKD')));
        }
        const starterSet = TextSegmenter.cache.starterSet;

        for (let i = 0; i < sentences.length; i++) {
            // Optimization: Assume sentences are already normalized by TextSegmenter.segment() during ingestion.
            // Avoiding re-normalization improves performance significantly.

            // Optimization: Delay cloning. We only clone if we are pushing to 'merged' to start a new segment.
            // If we merge into the previous segment, we read from 'current' (immutable in this context)
            // and write to 'last' (already cloned/created).
            const current = sentences[i];

            if (merged.length > 0) {
                const last = merged[merged.length - 1];

                // Optimization: Avoid trim() by using regexes that ignore whitespace.
                // const lastTextTrimmed = last.text.trim();

                // Check if last segment ends with an abbreviation
                let isAbbreviation = false;
                let lastWord = '';

                // Try checking the last word
                const oneWordMatch = RE_LAST_WORD_TRIMLESS.exec(last.text);
                const rawLastWord = oneWordMatch ? oneWordMatch[1] : '';
                // Remove leading punctuation (e.g., "(Mr." -> "Mr.")
                const cleanLastWord = rawLastWord.replace(RE_LEADING_PUNCTUATION, '');

                if (abbrSet.has(cleanLastWord.toLowerCase())) {
                    isAbbreviation = true;
                    lastWord = cleanLastWord;
                } else {
                    // Try checking the last two words
                    const twoWordsMatch = RE_LAST_TWO_WORDS_TRIMLESS.exec(last.text);
                    if (twoWordsMatch) {
                        const rawLastTwo = twoWordsMatch[1];
                        // Remove leading punctuation from the phrase (e.g. "(et al." -> "et al.")
                        const cleanLastTwo = rawLastTwo.replace(RE_LEADING_PUNCTUATION, '');

                        if (abbrSet.has(cleanLastTwo.toLowerCase())) {
                            isAbbreviation = true;
                            lastWord = cleanLastTwo;
                        }
                    }
                }

                if (isAbbreviation) {
                    let shouldMerge = false;

                    // Check if the abbreviation (either full text or last word) is in the alwaysMerge list
                    if (mergeSet.has(lastWord.toLowerCase())) {
                        shouldMerge = true;
                    } else {
                        // Check the next segment (current)
                        // Optimization: Avoid trim() using regex
                        const match = RE_FIRST_WORD_TRIMLESS.exec(current.text);
                        const nextFirstWord = match ? match[1] : '';
                        const cleanNextWord = nextFirstWord.replace(RE_TRAILING_PUNCTUATION, '');

                        if (!starterSet.has(cleanNextWord)) {
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
                buffer.text += (buffer.text.endsWith(' ') ? '' : ' ') + current.text;

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
                last.text += (last.text.endsWith(' ') ? '' : ' ') + buffer.text;

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
