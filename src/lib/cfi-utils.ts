import { EpubCFI, type Book } from 'epubjs';
import { getCachedSegmenter } from './tts/segmenter-cache';

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
 * Standard (Slow) CFI merging logic using parsing and regeneration.
 * Used as a fallback for tryFastMergeCfi and for equivalence testing.
 */
export function mergeCfiSlow(left: string, right: string): string | null {
    const startCfi = parseCfiRange(left);
    const endCfi = parseCfiRange(right);

    // If startCfi/endCfi are null, it means they are point CFIs (or invalid).
    // We use the raw CFI string in that case.
    const startPoint = startCfi ? startCfi.fullStart : left;
    const endPoint = endCfi ? endCfi.fullEnd : right;

    if (startPoint && endPoint) {
        // generateCfiRange takes two points (start and end) and finds the common parent.
        return generateCfiRange(startPoint, endPoint);
    }
    return null;
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

        // Use cached segmenter if available
        const segmenter = getCachedSegmenter('en');
        if (segmenter) {
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

/**
 * Optimistically tries to merge two CFIs if they share a common parent,
 * avoiding the overhead of full string parsing and regeneration in generateCfiRange.
 *
 * Supports merging:
 * - Range + Range (if parents match)
 * - Range + Point (if Point is within Range's parent)
 * - Point + Range (if Range is within Point's parent scope - less common)
 *
 * @returns The merged CFI string or null if fast merge is not possible.
 */
export function tryFastMergeCfi(left: string, right: string): string | null {
    if (!left || !right || !left.startsWith('epubcfi(') || !right.startsWith('epubcfi(')) return null;

    // Fast check for Range structure (has commas)
    const lFirstComma = left.indexOf(',');

    if (lFirstComma !== -1) {
        // LEFT IS RANGE
        // Check validity of Range structure
        const lSecondComma = left.indexOf(',', lFirstComma + 1);
        if (lSecondComma === -1) return null; // Invalid Range

        // Extract Parent: epubcfi(PARENT, ...
        // Slice from 8 to first comma
        const parent = left.slice(8, lFirstComma);

        const rFirstComma = right.indexOf(',');

        if (rFirstComma !== -1) {
            // RIGHT IS RANGE (Case 1)
            // Check if right has same parent
            // Compare substring directly
            // right starts with "epubcfi(" + parent + "," ?
            // Construct prefix to check
            const rPrefix = `epubcfi(${parent},`;
            if (right.startsWith(rPrefix)) {
                // Parents match!
                // We need: epubcfi(P, S, E)
                // S = left start component = left.slice(lFirstComma + 1, lSecondComma) (includes comma? No, +1)
                // But we want to include the comma before S.
                // left is "epubcfi(P,S,E)".
                // We want to construct "epubcfi(P,S,E_from_right)"
                // "epubcfi(P,S," is left.slice(0, lSecondComma + 1)

                // right is "epubcfi(P,S2,E2)"
                // rFirstComma is after P. rSecondComma is after S2.
                // E2 is right.slice(rSecondComma + 1, -1)
                const rSecondComma = right.indexOf(',', rFirstComma + 1);
                if (rSecondComma !== -1) {
                     const rightEnd = right.slice(rSecondComma + 1, -1);
                     // leftStartPart includes "epubcfi(P,S"
                     const leftStartPart = left.slice(0, lSecondComma);
                     return `${leftStartPart},${rightEnd})`;
                }
            }
        } else {
            // RIGHT IS POINT (Case 2)
            // Check if right is child of parent
            // right = "epubcfi(P/S)"
            const prefix = `epubcfi(${parent}`;
            if (right.startsWith(prefix)) {
                 const remaining = right.slice(prefix.length);
                 // Must start with separator
                 if (['/', ':', '['].includes(remaining[0])) {
                      // Valid child
                      const rightEnd = remaining.endsWith(')') ? remaining.slice(0, -1) : remaining;
                      // Construct: epubcfi(P, S, rightEnd)
                      // leftStartPart = epubcfi(P,S
                      const leftStartPart = left.slice(0, lSecondComma);
                      return `${leftStartPart},${rightEnd})`;
                 }
            }
        }
    } else {
        // LEFT IS POINT
        // Check if Right is Range (Case 3)
        const rFirstComma = right.indexOf(',');
        if (rFirstComma !== -1) {
             const rSecondComma = right.indexOf(',', rFirstComma + 1);
             if (rSecondComma !== -1) {
                 const parent = right.slice(8, rFirstComma);
                 // Check if left is child
                 const prefix = `epubcfi(${parent}`;
                 if (left.startsWith(prefix)) {
                     const remaining = left.slice(prefix.length);
                     if (['/', ':', '['].includes(remaining[0])) {
                          const leftStart = remaining.endsWith(')') ? remaining.slice(0, -1) : remaining;
                          // Construct: epubcfi(P, leftStart, rightEnd)
                          // rightEnd = right.slice(rSecondComma + 1, -1)
                          const rightEnd = right.slice(rSecondComma + 1, -1);
                          return `epubcfi(${parent},${leftStart},${rightEnd})`;
                     }
                 }
             }
        }
    }

    return null;
}
