import { generateCfiRange, parseCfiRange } from '../cfi-utils';
import type { SentenceNode } from '../tts';

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

/**
 * Robust text segmentation utility using Intl.Segmenter with fallback and post-processing.
 * Handles edge cases like abbreviations (e.g., "Mr.", "i.e.") to prevent incorrect sentence splitting.
 */
export class TextSegmenter {
    private segmenter: Intl.Segmenter | undefined;

    /**
     * Initializes the TextSegmenter.
     *
     * @param locale - The locale for Intl.Segmenter (default 'en').
     */
    constructor(locale: string = 'en') {
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            this.segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
        }
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
        const sentenceRegex = /([^.!?]+[.!?]+)/g;
        let match;
        let lastIndex = 0;

        while ((match = sentenceRegex.exec(text)) !== null) {
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
        const abbrSet = new Set(abbreviations.map(s => s.normalize('NFKD').toLowerCase())); // Normalize for case-insensitive check
        const mergeSet = new Set(alwaysMerge.map(s => s.normalize('NFKD').toLowerCase()));
        const starterSet = new Set(sentenceStarters.map(s => s.normalize('NFKD'))); // Starters are usually Case Sensitive (e.g. "He" vs "he")

        for (let i = 0; i < sentences.length; i++) {
            const current = { ...sentences[i], text: sentences[i].text.normalize('NFKD') };

            if (merged.length > 0) {
                const last = merged[merged.length - 1];
                const lastTextTrimmed = last.text.trim();

                // Check if last segment ends with an abbreviation
                let isAbbreviation = false;
                let lastWord = '';

                // Try checking the last word
                const oneWordMatch = /\S+$/.exec(lastTextTrimmed);
                const rawLastWord = oneWordMatch ? oneWordMatch[0] : lastTextTrimmed;
                // Remove leading punctuation (e.g., "(Mr." -> "Mr.")
                const cleanLastWord = rawLastWord.replace(/^['"([<{]+/, '');

                if (abbrSet.has(cleanLastWord.toLowerCase())) {
                    isAbbreviation = true;
                    lastWord = cleanLastWord;
                } else {
                    // Try checking the last two words
                    // Capture last two whitespace-separated tokens
                    // (?: ... ) is non-capturing group
                    const twoWordsMatch = /(?:\S+\s+)\S+$/.exec(lastTextTrimmed);
                    if (twoWordsMatch) {
                        const rawLastTwo = twoWordsMatch[0];
                        // Remove leading punctuation from the phrase (e.g. "(et al." -> "et al.")
                        const cleanLastTwo = rawLastTwo.replace(/^['"([<{]+/, '');

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
                        const nextTextTrimmed = current.text.trim();
                        const match = /^\S+/.exec(nextTextTrimmed);
                        const nextFirstWord = match ? match[0] : nextTextTrimmed;
                        const cleanNextWord = nextFirstWord.replace(/[.,!?;:]$/, '');

                        if (!starterSet.has(cleanNextWord)) {
                            shouldMerge = true;
                        }
                    }

                    if (shouldMerge) {
                        // Merge current into last
                        last.text += (last.text.endsWith(' ') ? '' : ' ') + current.text;

                        // Merge CFIs
                        const startCfi = parseCfiRange(last.cfi);
                        const endCfi = parseCfiRange(current.cfi);

                        if (startCfi && endCfi) {
                             // We want the range from the START of the first segment to the END of the second segment.
                             // generateCfiRange takes two points (start and end) and finds the common parent.
                             last.cfi = generateCfiRange(startCfi.fullStart, endCfi.fullEnd);
                        }

                        continue;
                    }
                }
            }

            merged.push(current);
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
                const startCfi = parseCfiRange(buffer.cfi);
                const endCfi = parseCfiRange(current.cfi);
                if (startCfi && endCfi) {
                    buffer.cfi = generateCfiRange(startCfi.fullStart, endCfi.fullEnd);
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

                const startCfi = parseCfiRange(last.cfi);
                const endCfi = parseCfiRange(buffer.cfi);
                if (startCfi && endCfi) {
                    last.cfi = generateCfiRange(startCfi.fullStart, endCfi.fullEnd);
                }
            } else {
                lengthMerged.push(buffer);
            }
        }

        return lengthMerged;
    }
}
