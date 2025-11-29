export interface TextSegment {
    text: string;
    index: number;
    length: number;
}

const TITLES = new Set([
    'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Gen.', 'Rep.', 'Sen.', 'Jr.', 'Sr.'
]);

const SENTENCE_STARTERS = new Set([
    'The', 'A', 'An', 'It', 'Is', 'Are', 'He', 'She', 'They', 'We', 'I', 'You',
    'This', 'That', 'There', 'Here', 'Then', 'When', 'Where', 'Why', 'How',
    'But', 'And', 'Or', 'So', 'Because', 'If', 'While', 'Although'
]);

export class TextSegmenter {
    private segmenter: Intl.Segmenter | undefined;
    private abbreviations: Set<string>;

    constructor(locale: string = 'en', abbreviations: string[] = []) {
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            this.segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
        }
        this.abbreviations = new Set(abbreviations);
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
                let matchedAbbrev = '';

                if (this.abbreviations.has(lastTextTrimmed)) {
                    isAbbreviation = true;
                    matchedAbbrev = lastTextTrimmed;
                } else {
                    // Check if it ends with any abbreviation
                    const words = lastTextTrimmed.split(/\s+/);
                    const lastWord = words[words.length - 1];
                    if (this.abbreviations.has(lastWord)) {
                        isAbbreviation = true;
                        matchedAbbrev = lastWord;
                    }
                }

                if (isAbbreviation) {
                    let shouldMerge = true;
                    const nextText = current.text.trim();

                    if (nextText.length > 0) {
                        const firstChar = nextText[0];
                        // Check if it starts with an uppercase letter
                        if (firstChar >= 'A' && firstChar <= 'Z') {
                            const firstWord = nextText.split(/\s+/)[0].replace(/[^\w]/g, '');

                            const isTitle = TITLES.has(matchedAbbrev);
                            // If it's not a title (like Mr. or Dr.) and looks like a new sentence start
                            if (!isTitle && SENTENCE_STARTERS.has(firstWord)) {
                                shouldMerge = false;
                            }
                        }
                    }

                    if (shouldMerge) {
                        last.text += current.text;
                        last.length += current.length;
                        // We don't change last.index
                        continue;
                    }
                }
            }

            // If not merged, push as new segment
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
