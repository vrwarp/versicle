import { EpubCFI, type Book } from 'epubjs';

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

/**
 * Extracts the last numeric step index from a CFI path.
 * e.g. epubcfi(/6/4!/4/2) -> 2
 */
export function getLastStepIndex(cfi: string): number {
    const match = cfi.match(/\/(\d+)[^/]*\)?$/);
    return match ? parseInt(match[1], 10) : -1;
}

/**
 * Extracts the parent block-level CFI from a given CFI string.
 * This handles both range CFIs and point/standard CFIs.
 * 
 * @param cfi The CFI string (range or standard).
 * @returns The parent CFI or 'unknown' if extraction fails.
 */
export function getParentCfi(cfi: string): string {
    if (!cfi) return 'unknown';

    let spine = '';
    let path = '';
    let isRange = false;

    // 1. Try parsing as a Range CFI (epubcfi(parent, start, end))
    const parsed = parseCfiRange(cfi);
    if (parsed) {
        isRange = true;
        const parts = parsed.parent.split('!');
        spine = parts[0];
        path = parts[1] || '';
    } else if (cfi.startsWith('epubcfi(')) {
        // 2. Fallback: Try handling as a Standard/Point CFI (epubcfi(/.../!/...))
        try {
            const content = cfi.replace(/^epubcfi\((.*)\)$/, '$1');
            const parts = content.split('!');
            spine = parts[0];
            path = parts[1] || '';
        } catch (e) {
            console.warn("Failed to extract parent CFI", e);
        }
    }

    // Return original if we can't parse it
    if (!spine) return cfi;

    if (path) {
        // Heuristic: The text node is usually the last component (e.g. /4/2/1:0)
        // We want the parent block element (e.g. /4/2).
        const pathParts = path.split('/');

        // Filter empty strings from split
        const cleanParts = pathParts.filter(p => p.length > 0);

        // HEURISTIC: Structural Snapping
        // Snap to "Container Depth" (Total Level 4)
        // e.g. /6/14!/4/2 (Spine depth 2 + Path depth 2 = 4)
        // e.g. /14/2/2/10/2 (Spine depth ? + Path depth 4) -> Snap to 4 total?

        // Calculate spine depth
        const spineDepth = spine.split('/').filter(p => p.length > 0).length;
        const targetPathDepth = Math.max(1, 4 - spineDepth);

        if (cleanParts.length > targetPathDepth) {
            return `epubcfi(${spine}!/${cleanParts.slice(0, targetPathDepth).join('/')})`;
        }

        // Standard leaf-stripping for shallow paths
        // We only pop if it's NOT a Range CFI. Range CFIs already point to the common ancestor container.
        // Point CFIs point to a text node (leaf), so we want the parent element.
        if (!isRange && cleanParts.length > 0) {
            cleanParts.pop();
        }

        return cleanParts.length === 0
            ? `epubcfi(${spine}!)`
            : `epubcfi(${spine}!/${cleanParts.join('/')})`;
    } else {
        // Just spine item reference
        return `epubcfi(${spine}!)`;
    }
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

    // Determine if the current split point is valid without backtracking.
    // A split is valid if we are at a step boundary.
    // This happens if the next character in *each* string (if it exists) is a delimiter.
    // If we are at the end of the string, that counts as a boundary.
    const delimiters = ['/', '!', ':'];
    const sNext = i < start.length ? start[i] : null;
    const eNext = i < end.length ? end[i] : null;

    const sOk = sNext === null || delimiters.includes(sNext);
    const eOk = eNext === null || delimiters.includes(eNext);

    // Only backtrack if we are NOT at a valid boundary
    if (!sOk || !eOk) {
        // Backtrack to valid delimiter
        while (i > 0) {
            const char = start[i];
            // If remainder starts with separator, it's a good split point
            // AND both strings are identical at this point (part of common prefix)
            if (delimiters.includes(char) && start[i] === end[i]) {
                 break;
            }
            i--;
        }
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
        let p = parseCfiRange(r);
        if (!p) {
            // Try parsing as point CFI (no commas)
            // e.g. epubcfi(/6/14!/4/2/1:0)
            if (r.startsWith('epubcfi(') && r.endsWith(')') && !r.includes(',')) {
                const raw = r.slice(8, -1);
                p = {
                    parent: '', // Unused in merge logic
                    start: '',  // Unused
                    end: '',    // Unused
                    rawStart: raw,
                    rawEnd: raw,
                    fullStart: r,
                    fullEnd: r
                };
            }
        }

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

export function generateEpubCfi(range: Range, baseCfi: string): string {
    try {
        let baseComponent = baseCfi;
        if (baseComponent.startsWith('epubcfi(') && baseComponent.endsWith(')')) {
            baseComponent = baseComponent.slice(8, -1);
        }

        // Take the part before '!' if present
        if (baseComponent.includes('!')) {
            baseComponent = baseComponent.split('!')[0];
        }

        const cfi = new EpubCFI(range, baseComponent);
        return cfi.toString();
    } catch (e) {
        console.error("Error generating CFI", e);
        return "";
    }
}

export async function snapCfiToSentence(book: Book, cfi: string): Promise<string> {
    try {
        // Lifecycle safety check: ensure book instance is valid
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!book || !(book as any).spine) {
            console.warn('snapCfiToSentence: Book instance is destroyed or invalid. Returning raw CFI.');
            return cfi;
        }

        if (!cfi || !cfi.includes('!')) return cfi;

        const range = await book.getRange(cfi);
        if (!range) return cfi;

        const startNode = range.startContainer;
        const startOffset = range.startOffset;

        if (startNode.nodeType !== Node.TEXT_NODE) {
            return cfi;
        }

        const text = startNode.textContent || '';

        // Use Intl.Segmenter if available
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
             const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
             const segments = segmenter.segment(text);
             let bestStart = 0;
             for (const segment of segments) {
                 if (segment.index <= startOffset) {
                     bestStart = segment.index;
                 } else {
                     break;
                 }
             }

             if (bestStart !== startOffset) {
                 const newRange = document.createRange();
                 newRange.setStart(startNode, bestStart);
                 newRange.setEnd(startNode, bestStart);

                 let baseCfi = cfi.split('!')[0] + '!';
                 if (baseCfi.startsWith('epubcfi(')) {
                     baseCfi = baseCfi.slice(8);
                 }

                 const newCfi = new EpubCFI(newRange, baseCfi).toString();
                 return newCfi;
             }
        }

        return cfi;
    } catch (e) {
        console.warn('snapCfiToSentence failed', e);
        return cfi;
    }
}
