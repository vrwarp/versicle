export interface Segment {
    text: string;
    index: number;
    length: number;
}

const COMMON_ABBREVIATIONS = new Set([
    'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'st.', 'mt.',
    'e.g.', 'i.e.', 'etc.', 'vs.', 'fig.', 'vol.', 'no.', 'ch.', 'p.', 'pp.'
]);

export class TextSegmenter {
    private segmenter: Intl.Segmenter | null = null;
    private regexFallback: RegExp;

    constructor(lang: string = 'en') {
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            this.segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' });
        }
        // Fallback for environments without Intl.Segmenter
        this.regexFallback = /([^\.!\?]+[\.!\?]+)/g;
    }

    segment(text: string): Segment[] {
        let rawSegments: Segment[] = [];

        if (this.segmenter) {
            const segments = Array.from(this.segmenter.segment(text));
            rawSegments = segments
                .filter(s => s.segment.trim().length > 0)
                .map(s => ({
                    text: s.segment,
                    index: s.index,
                    length: s.segment.length
                }));
        } else {
             let match;
             this.regexFallback.lastIndex = 0;
             let lastIndex = 0;

             while ((match = this.regexFallback.exec(text)) !== null) {
                 rawSegments.push({
                     text: match[0],
                     index: match.index,
                     length: match[0].length
                 });
                 lastIndex = match.index + match[0].length;
             }

             if (lastIndex < text.length) {
                 const remaining = text.substring(lastIndex);
                 if (remaining.trim().length > 0) {
                     rawSegments.push({
                         text: remaining,
                         index: lastIndex,
                         length: remaining.length
                     });
                 }
             }
        }

        // Post-process to merge abbreviations
        return this.mergeAbbreviations(rawSegments);
    }

    private mergeAbbreviations(segments: Segment[]): Segment[] {
        if (segments.length === 0) return [];

        const result: Segment[] = [];
        let currentMerged = segments[0];

        for (let i = 1; i < segments.length; i++) {
            const next = segments[i];
            const prevTrimmed = currentMerged.text.trim();
            const prevLastWord = prevTrimmed.split(/\s+/).pop()?.toLowerCase();

            if (prevLastWord && COMMON_ABBREVIATIONS.has(prevLastWord)) {
                // Merge next into currentMerged
                currentMerged = {
                    text: currentMerged.text + next.text,
                    index: currentMerged.index,
                    length: currentMerged.length + next.length
                };
            } else {
                // Push currentMerged and start new
                result.push(currentMerged);
                currentMerged = next;
            }
        }

        // Push the final segment
        result.push(currentMerged);

        return result;
    }
}
