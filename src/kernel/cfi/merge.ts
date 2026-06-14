/**
 * CFI range algebra — generate / merge, ported verbatim from
 * src/lib/cfi-utils.ts (phase5-tts-strangler.md §5c.4). `tryFastMergeCfi`
 * is the string fast path; `mergeCfiSlow` (parse + regenerate) is its
 * oracle, pinned by the property suite in cfi.equivalence.fuzz.test.ts:
 * fast === null || fast === slow.
 */
import { parseCfiRange, stripCfiWrapper } from './parse';
import type { CfiRangeData } from './parse';
import { CfiComparator, tryParseCfiPoint } from './epubcfiShim';
import type { ParsedCfiPoint } from './epubcfiShim';

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

export function generateCfiRange(start: string, end: string): string {
    start = stripCfiWrapper(start);
    end = stripCfiWrapper(end);

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

/** A parsed range plus its pre-parsed endpoints, used by the merge sweep. */
interface MergeRange extends CfiRangeData {
    parsedStart?: ParsedCfiPoint;
    parsedEnd?: ParsedCfiPoint;
}

export function mergeCfiRanges(ranges: string[], newRange?: string): string[] {
    // OPTIMIZATION: Optimistic Append for Sequential Reading
    // If ranges is sorted (which it usually is) and newRange starts AFTER the last range,
    // we can skip full resort and only merge the tail.
    // This reduces O(N) overhead to O(1) for sequential reading.
    if (ranges.length > 1 && newRange) {
        try {
            const last = ranges[ranges.length - 1];
            const pLast = parseCfiRange(last);
            const pNew = parseCfiRange(newRange);

            if (pLast && pNew) {
                const cfi = new CfiComparator();
                // Pre-parse to avoid instantiation overhead in compare()
                const newStartParsed = tryParseCfiPoint(pNew.fullStart);
                const lastStartParsed = tryParseCfiPoint(pLast.fullStart);

                // Check if newRange starts at or after last range starts.
                // If so, it only interacts with the last range (since ranges are sorted and disjoint).
                if (newStartParsed && lastStartParsed && cfi.compare(newStartParsed, lastStartParsed) >= 0) {
                    // Fast path: Merge [last, newRange] only.
                    // Recursive call with 2 items falls through to standard logic (since length=1).
                    const tail = mergeCfiRanges([last], newRange);
                    return [...ranges.slice(0, -1), ...tail];
                }
            }
        } catch {
            // Fallback to slow path on error
        }
    }

    const allRanges = [...ranges];
    if (newRange) allRanges.push(newRange);

    if (allRanges.length === 0) return [];

    const cfi = new CfiComparator();

    const parsedRanges: MergeRange[] = [];

    for (const r of allRanges) {
        let p: MergeRange | null = parseCfiRange(r);
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
            // If invalid CFI, we can't parse it. It'll fail sorting.
            p.parsedStart = tryParseCfiPoint(p.fullStart) ?? undefined;
            p.parsedEnd = tryParseCfiPoint(p.fullEnd) ?? undefined;
            parsedRanges.push(p);
        }
    }

    if (parsedRanges.length === 0) return [];

    // Filter out invalid CFIs before sorting to ensure parsedStart/End exist
    const validRanges = parsedRanges.filter(r => r.parsedStart && r.parsedEnd);
    if (validRanges.length === 0) return allRanges; // Fallback

    // Sort by fullStart
    try {
        validRanges.sort((a, b) => cfi.compare(a.parsedStart!, b.parsedStart!));
    } catch (e) {
        console.error("Error comparing CFIs", e);
        return allRanges;
    }

    const merged: MergeRange[] = [];
    let current = validRanges[0];

    for (let i = 1; i < validRanges.length; i++) {
        const next = validRanges[i];

        // Check overlap: next.start <= current.end
        try {
            if (cfi.compare(next.parsedStart!, current.parsedEnd!) <= 0) {
                // Merge
                // newEnd = Max(current.end, next.end)
                if (cfi.compare(next.parsedEnd!, current.parsedEnd!) > 0) {
                    current.fullEnd = next.fullEnd;
                    current.rawEnd = next.rawEnd;
                    current.parsedEnd = next.parsedEnd;
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
        // Optimization: Use substring from left directly to avoid allocation of parent string
        // left.slice(0, lFirstComma + 1) is "epubcfi(PARENT,"
        const lParentPrefix = left.slice(0, lFirstComma + 1);

        const rFirstComma = right.indexOf(',');

        if (rFirstComma !== -1) {
            // RIGHT IS RANGE (Case 1)
            // Check if right has same parent
            // Compare substring directly
            if (right.startsWith(lParentPrefix)) {
                // Parents match!
                // We need: epubcfi(P, S, E)
                // left is "epubcfi(P,S,E)"; we construct "epubcfi(P,S,E_from_right)".
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
            // prefix = "epubcfi(PARENT" = left.slice(0, lFirstComma)
            const lParentPrefixNoComma = left.slice(0, lFirstComma);
            if (right.startsWith(lParentPrefixNoComma)) {
                // Must start with separator
                // Check char at lFirstComma
                const separator = right[lFirstComma];
                if (separator && ['/', ':', '['].includes(separator)) {
                    // Valid child
                    const remaining = right.slice(lFirstComma);
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
                // Check if left is child
                // prefix = "epubcfi(PARENT" = right.slice(0, rFirstComma)
                const rParentPrefixNoComma = right.slice(0, rFirstComma);
                if (left.startsWith(rParentPrefixNoComma)) {
                    // Check separator
                    const separator = left[rFirstComma];
                    if (separator && ['/', ':', '['].includes(separator)) {
                        const remaining = left.slice(rFirstComma);
                        const leftStart = remaining.endsWith(')') ? remaining.slice(0, -1) : remaining;
                        // Construct: epubcfi(P, leftStart, rightEnd)
                        const rightEnd = right.slice(rSecondComma + 1, -1);
                        return `${rParentPrefixNoComma},${leftStart},${rightEnd})`;
                    }
                }
            }
        } else {
            // Point + Point (Case 4)
            // Both are points (e.g. epubcfi(/6/14!/4/2/1:0) and epubcfi(/6/14!/4/2/1:10))

            // Fast path for identical path up to the colon
            const leftColon = left.lastIndexOf(':');
            if (leftColon !== -1) {
                const leftPath = left.slice(0, leftColon); // e.g. epubcfi(/6/14!/4/2/1
                if (right.startsWith(leftPath) && right[leftColon] === ':') {
                    // Same path! Extract offsets
                    const leftOffset = left.slice(leftColon, -1); // :0
                    const rightOffset = right.slice(leftColon, -1); // :10
                    return `${leftPath},${leftOffset},${rightOffset})`;
                }
            }

            // Fallback to finding common parent prefix via last slash.
            // We assume parent ends at the last slash of the LEFT point.
            const lastSlash = left.lastIndexOf('/');
            if (lastSlash > 8) { // Ensure slash is after "epubcfi("
                // Check if right matches prefix up to lastSlash (including the slash)
                const prefix = left.slice(0, lastSlash + 1);
                if (right.startsWith(prefix)) {
                    // Common parent found!
                    // Construct Range: epubcfi(P, S, E)
                    // Our prefix is "epubcfi(P/", so P is left.slice(0, lastSlash)
                    // and we append ",/" + S + ",/" + E.
                    const parentPrefix = left.slice(0, lastSlash);
                    const leftSuffix = left.slice(lastSlash + 1, -1); // Remove closing paren
                    const rightSuffix = right.slice(lastSlash + 1, -1); // Remove closing paren

                    return `${parentPrefix},/${leftSuffix},/${rightSuffix})`;
                }
            }
        }
    }

    return null;
}
