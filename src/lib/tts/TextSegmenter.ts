export interface TextSegment {
    text: string;
    index: number;
    length: number;
}

// Abbreviations that are almost exclusively titles and should always trigger a merge
// regardless of the next word.
export const DEFAULT_ALWAYS_MERGE = ['Mr.', 'Mrs.', 'Ms.', 'Prof.', 'Gen.', 'Rep.', 'Sen.'];

// Words that strongly indicate the start of a new sentence.
// If the next segment starts with one of these, we should not merge,
// even if the previous segment ended with an ambiguous abbreviation (like "Dr.").
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

export class TextSegmenter {
    private segmenter: Intl.Segmenter | undefined;
    private abbreviations: Set<string>;
    private alwaysMerge: Set<string>;
    private sentenceStarters: Set<string>;

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
                    const words = lastTextTrimmed.split(/\s+/);
                    lastWord = words[words.length - 1];
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
                        const nextFirstWord = nextTextTrimmed.split(/\s+/)[0];
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
}
