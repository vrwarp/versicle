/**
 * CfiGrouper — grouping text segments into logical blocks by CFI structure,
 * and attributing point markers to those groups (Phase 5c;
 * phase5-tts-strangler.md §5c.2). Moved beside the CFI kernel from
 * AudioContentPipeline's private methods; the inline `{rootCfi; segments;
 * fullText}` shape (re-declared three times in the legacy pipeline) becomes
 * the named {@link CfiGroup}.
 *
 * Kernel admission: structural types only (no ~types import); everything here
 * is CFI math over the sibling kernel modules.
 */
import { getParentCfi } from './contains';
import { cfiContains } from './contains';
import { generateCfiRange } from './merge';
import { parseCfiRange } from './parse';
import type { PreprocessedRoot } from './parse';
import { CfiComparator, tryParseCfiPoint } from './epubcfiShim';
import type { ParsedCfiPoint } from './epubcfiShim';

/** One extracted text segment with its location. Structural superset of SentenceNode. */
export interface CfiSegment {
    text: string;
    cfi: string;
    sourceIndices?: number[];
}

/** A logical block of consecutive segments sharing a structural root. */
export interface CfiGroup {
    /** Range CFI spanning the group (first segment start → last segment end). */
    rootCfi: string;
    segments: CfiSegment[];
    /** Concatenated text, capped (≈1000 chars) — enough for content-type detection. */
    fullText: string;
}

/**
 * Groups individual text segments by their common semantic root element using CFI structure.
 * This allows content-type classification of logical blocks (tables, asides) rather than
 * fragmented sentences.
 *
 * Branch membership uses the kernel's canonical {@link cfiContains} (THE separator set) —
 * the divergent inline copies died in 5c-PR1.
 */
export function groupSegmentsByRoot(
    segments: ReadonlyArray<CfiSegment>,
    blockRoots: string[] | PreprocessedRoot[] = []
): CfiGroup[] {
    const groups: CfiGroup[] = [];
    let currentGroup: { parentCfi: string; segments: CfiSegment[]; fullText: string } | null = null;

    // Cache the clean parent base for the current group to avoid repeated string ops
    let currentParentBase: string | null = null;

    const finalizeGroup = (group: { segments: CfiSegment[]; fullText: string }) => {
        const first = group.segments[0].cfi;
        const last = group.segments[group.segments.length - 1].cfi;

        // Convert to Range CFI: epubcfi(common,start,end)
        const rootCfi = generateCfiRange(
            parseCfiRange(first)?.fullStart || first,
            parseCfiRange(last)?.fullEnd || last
        );

        groups.push({
            rootCfi,
            segments: group.segments,
            fullText: group.fullText
        });
    };

    for (const s of segments) {
        const fullCfi = s.cfi || '';
        const parentCfi = getParentCfi(fullCfi, blockRoots);

        // Helper to check if the current group already "contains" this new parent
        if (currentGroup && currentParentBase === null) {
            // Initialize cache if missing
            currentParentBase = currentGroup.parentCfi.endsWith(')') ? currentGroup.parentCfi.slice(0, -1) : currentGroup.parentCfi;
        }

        const newParentBase = parentCfi.endsWith(')') ? parentCfi.slice(0, -1) : parentCfi;

        // Check if one path is a prefix of the other (at a canonical step boundary),
        // confirming they belong to the same branch.
        const isDescendant = currentGroup && currentParentBase && cfiContains(currentParentBase, newParentBase);
        const isAncestor = currentGroup && currentParentBase && cfiContains(newParentBase, currentParentBase);

        const isInternalNode = isDescendant || isAncestor;

        if (!currentGroup || !isInternalNode) {
            if (currentGroup) {
                finalizeGroup(currentGroup);
            }
            currentGroup = { parentCfi, segments: [], fullText: '' };
            // Reset cache
            currentParentBase = newParentBase;
        } else if (isAncestor) {
            // If the new sentence is an ancestor of the current group (e.g. a Div containing a P),
            // we expand the group's scope to the ancestor's level. This ensures subsequent
            // descendants of this ancestor are correctly included in the group.
            currentGroup.parentCfi = parentCfi;
            // Update cache
            currentParentBase = newParentBase;
        }

        currentGroup.segments.push(s);
        // Optimization: Only accumulate enough text for detection (200 chars needed, cap at 1000 for safety)
        if (currentGroup.fullText.length < 1000) {
            currentGroup.fullText += s.text + '. ';
        }
    }

    if (currentGroup) {
        finalizeGroup(currentGroup);
    }
    return groups;
}

/**
 * Attributes each point marker (e.g. a citation marker) to the group whose
 * [firstSegmentCfi, lastSegmentCfi] range contains it, using proper CFI comparison.
 * Returns a per-marker array of group indices (-1 when no group contains the marker
 * or comparison fails).
 */
export function attributeMarkersToGroups(
    groups: ReadonlyArray<{ segments: ReadonlyArray<{ cfi: string }> }>,
    markers: ReadonlyArray<{ cfi: string }>
): number[] {
    if (markers.length === 0) return [];
    const comparer = new CfiComparator();
    // Pre-parse group bounds once.
    //
    // The upper bound MUST be the END of the last segment, not the last segment's range CFI
    // itself. epubjs `compare` against a range CFI uses that range's START offset, so
    // parsing the last segment's range directly collapses the upper bound down to where the
    // last segment *begins*. For a single-segment group (first === last) that makes the
    // [start, end] window a single point, orphaning any marker that isn't exactly at the
    // segment start — e.g. a footnote-head back-reference that sits in a <span> before the
    // spoken text. Convert both ends to explicit point CFIs (first-segment start,
    // last-segment end) via parseCfiRange so the window spans the group's full extent.
    const bounds = groups.map(g => {
        const first = g.segments[0]?.cfi;
        const last = g.segments[g.segments.length - 1]?.cfi;
        if (!first || !last) return null;
        const startPoint = parseCfiRange(first)?.fullStart || first;
        const endPoint = parseCfiRange(last)?.fullEnd || last;
        const start = tryParseCfiPoint(startPoint);
        const end = tryParseCfiPoint(endPoint);
        return start && end ? { start, end } : null;
    });

    return markers.map(mk => {
        const parsed: ParsedCfiPoint | null = tryParseCfiPoint(mk.cfi);
        if (!parsed) return -1;
        for (let i = 0; i < bounds.length; i++) {
            const b = bounds[i];
            if (!b) continue;
            try {
                if (comparer.compare(parsed, b.start) >= 0 && comparer.compare(parsed, b.end) <= 0) {
                    return i;
                }
            } catch {
                // ignore this group
            }
        }
        return -1;
    });
}
