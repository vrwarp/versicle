import ePub from 'epubjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
const getEpubCFI = () => {
    if ((ePub as any).CFI) return (ePub as any).CFI;
    if ((ePub as any).default && (ePub as any).default.CFI) return (ePub as any).default.CFI;
    // Check global
    if (typeof window !== 'undefined' && (window as any).ePub && (window as any).ePub.CFI) return (window as any).ePub.CFI;

    // In test environment, sometimes ePub is the default export but structured differently
    // Just return what we found if it looks like a constructor?
    return (ePub as any).CFI;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

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

// Fallback comparator if epub.js is not available
// This is a naive implementation that might not handle all CFI edge cases correctly
// but prevents the app from crashing or failing to merge entirely.
function fallbackCfiCompare(a: string, b: string): number {
    if (a === b) return 0;

    // Remove epubcfi( and )
    const strip = (s: string) => s.replace(/^epubcfi\(|\)$/g, '');

    // Helper to split CFI into comparable parts
    // Handles /, :, and !
    const tokenize = (str: string) => {
        return str.split(/([/:!])/).filter(p => p !== '');
    };

    const aParts = tokenize(strip(a));
    const bParts = tokenize(strip(b));

    // Compare parts
    for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
        const partA = aParts[i];
        const partB = bParts[i];

        if (partA === partB) continue;

        // If separators, they have an order.
        // Hierarchy usually: ! (indirection) > / (step) > : (offset) ?
        // Actually, structurally they should match. If they don't, it's different branches.
        // Assuming valid CFIs, we compare integers if both are integers.

        const intA = parseInt(partA, 10);
        const intB = parseInt(partB, 10);

        if (!isNaN(intA) && !isNaN(intB)) {
            // Ensure we are comparing entire string as integer
            if (intA.toString() === partA && intB.toString() === partB) {
                 if (intA !== intB) return intA - intB;
            }
        }

        // String fallback
        if (partA < partB) return -1;
        if (partA > partB) return 1;
    }

    return aParts.length - bParts.length;
}

export function mergeCfiRanges(ranges: string[], newRange?: string): string[] {
    const allRanges = [...ranges];
    if (newRange) allRanges.push(newRange);

    if (allRanges.length === 0) return [];

    let cfi: any = null;
    const EpubCFI = getEpubCFI();

    if (EpubCFI) {
        try {
            cfi = new EpubCFI();
        } catch (e) {
            console.error("Failed to instantiate EpubCFI", e);
        }
    } else {
        console.warn("EpubCFI not found, using fallback comparator.");
    }

    const compareFn = (a: string, b: string) => {
        if (cfi) {
             return cfi.compare(a, b);
        }
        return fallbackCfiCompare(a, b);
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
