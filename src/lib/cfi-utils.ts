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
 * Extracts the spine index from a CFI string.
 * Assumes standard epub.js structure where the package spine is child 6 (e.g., /6/14...).
 *
 * @param cfi The CFI string.
 * @returns The spine index (0-based) or -1 if extraction fails.
 */
export function getSpineIndexFromCfi(cfi: string): number {
    if (!cfi) return -1;
    // Remove "epubcfi(" wrapper
    const clean = cfi.replace(/^epubcfi\((.*)\)$/, '$1');
    // Split by ! (indirection) or / (steps)
    // Standard CFI: /6/14[id]!/4/2/1:0

    // We expect /6/N...
    const parts = clean.split('/');
    // parts[0] is usually empty (leading /)
    // parts[1] is 6 (package spine)
    // parts[2] is the itemref index (e.g. 14)

    if (parts.length >= 3 && parts[1] === '6') {
        const step = parseInt(parts[2]);
        if (!isNaN(step)) {
             return (step / 2) - 1;
        }
    }
    return -1;
}

/**
 * Finds the index of the queue item closest to the target CFI.
 *
 * @param queue The list of items, each having a 'cfi' property.
 * @param targetCfi The target CFI to find.
 * @returns The index of the closest item, or -1 if not found.
 */
export function findClosestQueueItemIndex(queue: { cfi: string | null }[], targetCfi: string): number {
    if (!targetCfi || !queue.length) return -1;

    // Try exact string match first
    const exact = queue.findIndex(q => q.cfi === targetCfi);
    if (exact !== -1) return exact;

    // Use EpubCFI comparison
    try {
        const cfi = new EpubCFI();
        // Find the last item that is <= targetCfi (or closest match logic)
        // Since queue items are usually Point CFIs or Ranges.

        let bestIndex = -1;

        for (let i = 0; i < queue.length; i++) {
            const itemCfi = queue[i].cfi;
            if (!itemCfi) continue;

            // compare(a, b): -1 if a < b, 1 if a > b, 0 if equal
            const cmp = cfi.compare(itemCfi, targetCfi);

            if (cmp === 0) return i;
            if (cmp < 0) {
                // item is before target
                bestIndex = i;
            } else {
                // item is after target. Since queue is sorted (chronological),
                // we can assume the previous one was the closest start point.
                break;
            }
        }
        return bestIndex;
    } catch (e) {
        console.warn("CFI comparison failed", e);
        return -1;
    }
}

/**
 * Extracts the parent block-level CFI from a given CFI string.
 * This handles both range CFIs and point/standard CFIs.
 * 
 * @param cfi The CFI string (range or standard).
 * @param knownBlockRoots Optional list of CFI strings that are known block roots (e.g. tables). If the CFI is a descendant of one of these, it will be snapped to that root.
 * @returns The parent CFI or 'unknown' if extraction fails.
 */
export function getParentCfi(cfi: string, knownBlockRoots: string[] = []): string {
    if (!cfi) return 'unknown';

    // 1. Check known block roots (e.g. Tables) - Priority over Range CFI parsing
    if (knownBlockRoots.length > 0) {
        // Sort by length descending to match innermost table first
        const sortedRoots = [...knownBlockRoots].sort((a, b) => b.length - a.length);

        // Pre-clean the target CFI once
        const cleanCfi = cfi.replace(/^epubcfi\((.*)\)$/, '$1');

        for (const root of sortedRoots) {
            // Check prefix.
            let cleanRoot = root;
            const range = parseCfiRange(root);
            if (range && range.parent) {
                cleanRoot = range.parent;
            } else if (cleanRoot.startsWith('epubcfi(')) {
                 cleanRoot = cleanRoot.slice(8, -1);
            }

            if (cleanCfi.startsWith(cleanRoot)) {
                // Ensure boundary match:
                // If cleanCfi is exactly equal to cleanRoot, it's a match.
                // If cleanCfi is longer, the next char must be a separator (/ or ! or [ or ,)
                // Added comma to support Range CFIs as target (e.g. /6/24!/4/2/4 matches /6/24!/4/2/4,/1:0,...)
                const nextChar = cleanCfi[cleanRoot.length];
                if (!nextChar || ['/', '!', '[', ',', ':'].includes(nextChar)) {
                    return root;
                }
            }
        }
    }

    // 2. Try parsing as a Range CFI (epubcfi(parent, start, end))
    const parsed = parseCfiRange(cfi);
    if (parsed) {
        return `epubcfi(${parsed.parent})`;
    }

    // 3. Fallback: Try handling as a Standard/Point CFI (epubcfi(/.../!/...))
    if (cfi.startsWith('epubcfi(')) {
        try {
            const content = cfi.replace(/^epubcfi\((.*)\)$/, '$1');
            const parts = content.split('!');
            const spine = parts[0];
            const path = parts[1];

            if (path) {
                // Heuristic: The text node is usually the last component (e.g. /4/2/1:0)
                // We want the parent block element (e.g. /4/2).
                const pathParts = path.split('/');
                
                // Filter empty strings from split
                const cleanParts = pathParts.filter(p => p.length > 0);

                // Removed Old "Structural Snapping" (> 4 depth) logic here.

                // Standard leaf-stripping for shallow paths
                if (cleanParts.length > 0) {
                    cleanParts.pop();
                }

                return cleanParts.length === 0
                    ? `epubcfi(${spine}!)`
                    : `epubcfi(${spine}!/${cleanParts.join('/')})`;
            } else {
                // Just spine item reference
                return `epubcfi(${spine}!)`;
            }
        } catch (e) {
            console.warn("Failed to extract parent CFI", e);
        }
    }

    // Return original if we can't parse it (or 'unknown' based on preference, but original might be safer for grouping)
    return cfi;
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
            i--;
            const char = start[i];
            if ((delimiters.includes(char) || char === ',' || char === '[') && start[i] === end[i]) {
                 break;
            }
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

/**
 * Generates a CFI string for a given DOM Range relative to a base Spine CFI.
 * This is used for decoupled extraction where we don't have a rendered view.
 *
 * @param range - The DOM Range to generate a CFI for.
 * @param baseCfi - The base CFI for the spine item (e.g. "epubcfi(/6/14[chapter1_id]!)").
 * @returns A full CFI string (e.g. "epubcfi(/6/14[chapter1_id]!/4/2/1:0,/4/2/1:10)").
 */
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

/**
 * Snaps a CFI to the nearest sentence boundary.
 *
 * @param book - The epub.js Book instance.
 * @param cfi - The CFI to snap.
 * @returns The snapped CFI, or the original if snapping failed.
 *
 * @warning This function is asynchronous and relies on the Book instance being active.
 * Do NOT use this in component cleanup/unmount phases where the Book instance might be destroyed.
 */
export async function snapCfiToSentence(book: Book, cfi: string): Promise<string> {
    try {
        // Lifecycle safety check: ensure book instance is valid
        // Prevents crash during reader destruction if called late
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
