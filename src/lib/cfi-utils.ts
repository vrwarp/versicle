import { EpubCFI } from 'epubjs';

export interface CfiRangeData {
  parent: string;
  start: string;
  end: string;
  rawStart: string;
  rawEnd: string;
  fullStart: string;
  fullEnd: string;
}

export function parseCfiRange(range: string): CfiRangeData | null {
    if (!range || !range.startsWith('epubcfi(') || !range.endsWith(')')) return null;

    const content = range.slice(8, -1); // remove epubcfi( and )
    const parts = content.split(',');

    if (parts.length === 3) {
        const parent = parts[0];
        const start = parts[1];
        const end = parts[2];
        return {
            parent,
            start,
            end,
            rawStart: parent + start,
            rawEnd: parent + end,
            fullStart: `epubcfi(${parent}${start})`,
            fullEnd: `epubcfi(${parent}${end})`
        };
    }
    return null;
}

export function generateCfiRange(start: string, end: string): string {
    // Strip epubcfi( and ) if present
    if (start.startsWith('epubcfi(') && start.endsWith(')')) {
        start = start.slice(8, -1);
    }
    if (end.startsWith('epubcfi(') && end.endsWith(')')) {
        end = end.slice(8, -1);
    }

    let i = 0;
    while (i < start.length && i < end.length && start[i] === end[i]) {
        i++;
    }

    // Backtrack to valid delimiter
    while (i > 0) {
        const char = start[i];
        // If remainder starts with separator, it's a good split point
        if (['/', '!', ':'].includes(char)) {
             break;
        }
        i--;
    }

    const common = start.substring(0, i);
    const startRel = start.substring(i);
    const endRel = end.substring(i);

    return `epubcfi(${common},${startRel},${endRel})`;
}

export function mergeCfiRanges(ranges: string[], newRange?: string): string[] {
    const allRanges = [...ranges];
    if (newRange) allRanges.push(newRange);

    if (allRanges.length === 0) return [];

    const cfi = new EpubCFI();
    const compareFn = (a: string, b: string) => {
         return cfi.compare(a, b);
    };

    const parsedRanges: CfiRangeData[] = [];

    for (const r of allRanges) {
        const p = parseCfiRange(r);
        if (p) {
            parsedRanges.push(p);
        }
    }

    if (parsedRanges.length === 0) return [];

    // Sort by fullStart
    try {
        parsedRanges.sort((a, b) => compareFn(a.fullStart, b.fullStart));
    } catch (e) {
        console.error("Error comparing CFIs", e);
        return allRanges;
    }

    const merged: CfiRangeData[] = [];
    let current = parsedRanges[0];

    for (let i = 1; i < parsedRanges.length; i++) {
        const next = parsedRanges[i];

        // Check overlap: next.start <= current.end
        try {
            if (compareFn(next.fullStart, current.fullEnd) <= 0) {
                // Merge
                // newEnd = Max(current.end, next.end)
                if (compareFn(next.fullEnd, current.fullEnd) > 0) {
                    current.fullEnd = next.fullEnd;
                    current.rawEnd = next.rawEnd;
                }
            } else {
                merged.push(current);
                current = next;
            }
        } catch (e) {
            console.error("Error merging CFIs", e);
            // Fallback: push both
            merged.push(current);
            current = next;
        }
    }
    merged.push(current);

    return merged.map(r => generateCfiRange(r.rawStart, r.rawEnd));
}
