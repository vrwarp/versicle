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
    private abbreviations: Set<string>;
    private alwaysMerge: Set<string>;
    private sentenceStarters: Set<string>;

    /**
     * Initializes the TextSegmenter.
     *
     * @param locale - The locale for Intl.Segmenter (default 'en').
     * @param abbreviations - List of abbreviations to consider for merging.
     * @param alwaysMerge - List of words that always force a merge (e.g., titles).
     * @param sentenceStarters - List of words that definitely start a new sentence.
     */
    constructor(
        locale: string = 'en',
        abbreviations: string[] = [],
        alwaysMerge: string[] = DEFAULT_ALWAYS_MERGE,
        sentenceStarters: string[] = DEFAULT_SENTENCE_STARTERS
    ) {
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            this.segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
        }
        this.abbreviations = new Set(abbreviations);
        this.alwaysMerge = new Set(alwaysMerge);
        this.sentenceStarters = new Set(sentenceStarters);

        // Ensure alwaysMerge items are also in abbreviations so they trigger the merge logic
        for (const item of this.alwaysMerge) {
            this.abbreviations.add(item);
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

        if (this.segmenter) {
            const rawSegments = Array.from(this.segmenter.segment(text)).map(s => ({
                text: s.segment,
                index: s.index,
                length: s.segment.length
            }));
            return this.postProcess(rawSegments);
        }

        return this.fallbackSegment(text);
    }

    /**
     * Post-processes raw segments to merge incorrectly split sentences (e.g., due to abbreviations).
     *
     * @param segments - The raw segments from Intl.Segmenter.
     * @returns The refined list of segments.
     */
    private postProcess(segments: TextSegment[]): TextSegment[] {
        const merged: TextSegment[] = [];

        for (let i = 0; i < segments.length; i++) {
            const current = segments[i];

            if (merged.length > 0) {
                const last = merged[merged.length - 1];
                const lastTextTrimmed = last.text.trim();

                // Check if last segment ends with an abbreviation
                let isAbbreviation = false;
                let lastWord = '';

                if (this.abbreviations.has(lastTextTrimmed)) {
                    isAbbreviation = true;
                    lastWord = lastTextTrimmed;
                } else {
                    // Optimized: Get last word without splitting the whole string
                    const match = /\S+$/.exec(lastTextTrimmed);
                    const rawLastWord = match ? match[0] : lastTextTrimmed;

                    // Remove leading punctuation (e.g., "(Mr." -> "Mr.")
                    lastWord = rawLastWord.replace(/^['"([<{]+/, '');

                    if (this.abbreviations.has(lastWord)) {
                        isAbbreviation = true;
                        // lastWord is already set correctly
                    }
                }

                if (isAbbreviation) {
                    let shouldMerge = false;

                    if (this.alwaysMerge.has(lastWord)) {
                        shouldMerge = true;
                    } else {
                        // Check the next segment (current) to see if it looks like a new sentence
                        const nextTextTrimmed = current.text.trim();
                        // Optimized: Get first word without splitting the whole string
                        const match = /^\S+/.exec(nextTextTrimmed);
                        const nextFirstWord = match ? match[0] : nextTextTrimmed;

                        // Remove trailing punctuation from the word (e.g. "He," -> "He")
                        const cleanNextWord = nextFirstWord.replace(/[.,!?;:]$/, '');

                        if (!this.sentenceStarters.has(cleanNextWord)) {
                            shouldMerge = true;
                        }
                    }

                    if (shouldMerge) {
                        // Merge current into last
                        last.text += current.text;
                        last.length += current.length;
                        // We don't change last.index
                        continue;
                    }
                }
            }

            // If not merged, push as new segment
            // We need to copy it to avoid reference issues if we modify it later
            merged.push({ ...current });
        }

        return merged;
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
     * @returns A new list of refined (merged) sentences.
     */
    public static refineSegments(
        sentences: SentenceNode[],
        abbreviations: string[],
        alwaysMerge: string[],
        sentenceStarters: string[]
    ): SentenceNode[] {
        if (!sentences || sentences.length === 0) return [];

        const merged: SentenceNode[] = [];
        const abbrSet = new Set(abbreviations.map(s => s.toLowerCase())); // Normalize for case-insensitive check
        const mergeSet = new Set(alwaysMerge.map(s => s.toLowerCase()));
        const starterSet = new Set(sentenceStarters); // Starters are usually Case Sensitive (e.g. "He" vs "he")

        for (let i = 0; i < sentences.length; i++) {
            const current = sentences[i];

            if (merged.length > 0) {
                const last = merged[merged.length - 1];
                const lastTextTrimmed = last.text.trim();

                // Check if last segment ends with an abbreviation
                let isAbbreviation = false;
                let lastWord = '';

                // Check full segment text first (e.g. for multi-word abbreviations defined by user)
                if (abbrSet.has(lastTextTrimmed.toLowerCase())) {
                    isAbbreviation = true;
                    lastWord = lastTextTrimmed;
                } else {
                    // Optimized: Get last word without splitting the whole string
                    const match = /\S+$/.exec(lastTextTrimmed);
                    const rawLastWord = match ? match[0] : lastTextTrimmed;
                    // Remove leading punctuation (e.g., "(Mr." -> "Mr.")
                    lastWord = rawLastWord.replace(/^['"([<{]+/, '');

                    // Case-insensitive check
                    if (abbrSet.has(lastWord.toLowerCase())) {
                        isAbbreviation = true;
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

            merged.push({ ...current });
        }

        return merged;
    }
}
