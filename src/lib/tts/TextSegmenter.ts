/**
 * A robust sentence segmenter using Intl.Segmenter with fallback.
 */
export class TextSegmenter {
    private segmenter: Intl.Segmenter | null = null;
    private static instance: TextSegmenter;

    private constructor() {
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            this.segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
        }
    }

    static getInstance(): TextSegmenter {
        if (!TextSegmenter.instance) {
            TextSegmenter.instance = new TextSegmenter();
        }
        return TextSegmenter.instance;
    }

    /**
     * Segments text into sentences.
     * @param text The input text.
     * @returns Array of sentences.
     */
    segment(text: string): { segment: string; index: number; input: string }[] {
        if (this.segmenter) {
            return Array.from(this.segmenter.segment(text));
        } else {
            // Fallback for environments without Intl.Segmenter (e.g., some JSDOM configs or older browsers)
            // Naive split, but keeping structure similar to Intl.Segmenter
            const segments: { segment: string; index: number; input: string }[] = [];
            const regex = /([^\.!\?]+[\.!\?]+)/g;
            let match;
            let lastIndex = 0;

            while ((match = regex.exec(text)) !== null) {
                segments.push({
                    segment: match[0],
                    index: match.index,
                    input: text
                });
                lastIndex = match.index + match[0].length;
            }

            if (lastIndex < text.length) {
                segments.push({
                    segment: text.substring(lastIndex),
                    index: lastIndex,
                    input: text
                });
            }

            return segments;
        }
    }
}
