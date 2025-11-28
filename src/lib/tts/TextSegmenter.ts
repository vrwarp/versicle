export interface TextSegment {
    text: string;
    index: number;
    length: number;
}

export interface TextSegmenterConfig {
    locale?: string;
    additionalAbbreviations?: string[];
}

export class TextSegmenter {
    private segmenter: Intl.Segmenter | undefined;
    private abbreviations: Set<string>;

    private static readonly DEFAULT_ABBREVIATIONS = [
        'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Gen.', 'Rep.', 'Sen.', 'St.', 'vs.', 'Jr.', 'Sr.',
        'e.g.', 'i.e.'
    ];

    constructor(configOrLocale: string | TextSegmenterConfig = 'en') {
        let locale = 'en';
        let additionalAbbreviations: string[] = [];

        if (typeof configOrLocale === 'string') {
            locale = configOrLocale;
        } else {
            locale = configOrLocale.locale || 'en';
            additionalAbbreviations = configOrLocale.additionalAbbreviations || [];
        }

        this.abbreviations = new Set([
            ...TextSegmenter.DEFAULT_ABBREVIATIONS,
            ...additionalAbbreviations
        ]);

        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            this.segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
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

                if (this.abbreviations.has(lastTextTrimmed)) {
                    isAbbreviation = true;
                } else {
                    // Check if it ends with any abbreviation
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
            merged.push({ ...current });
        }

        return merged;
    }

    private fallbackSegment(text: string): TextSegment[] {
        const sentences: TextSegment[] = [];
        const sentenceRegex = /([^\.!\?]+[\.!\?]+)/g;
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
