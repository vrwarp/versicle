export interface TextSegment {
    text: string;
    index: number;
    length: number;
}

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
                // We check if the trimmed text IS an abbreviation OR ends with " Abbrev."
                let isAbbreviation = false;

                if (this.abbreviations.has(lastTextTrimmed)) {
                    isAbbreviation = true;
                } else {
                    // Check if it ends with any abbreviation
                    // This is less efficient but robust.
                    // Since abbrevs set is small, we can iterate or split.
                    const words = lastTextTrimmed.split(/\s+/);
                    const lastWord = words[words.length - 1];
                    if (this.abbreviations.has(lastWord)) {
                        isAbbreviation = true;
                    }
                }

                if (isAbbreviation) {
                    // Merge current into last
                    last.text += current.text;
                    last.length += current.length;
                    // We don't change last.index
                    continue;
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
