/**
 * src/kernel/cfi — the canonical CFI algebra (Phase 5c;
 * phase5-tts-strangler.md §5c.4, contract C12 / master plan §2 rule 1).
 *
 * Kernel admission: zero internal imports (epubjs's CFI submodule is the one
 * external dependency, quarantined in ./epubcfiShim) and ≥2 consuming
 * domains — TTS (pipeline, segmenter, dragnet) consumes it now; the reader
 * adopts in P6. Until then `src/lib/cfi-utils.ts` is a re-export shim for
 * reader-side imports (named deletion deadline: Phase 6).
 *
 * The parsed-component model in ./parse is the REFERENCE: every string fast
 * path here survives only behind the seeded property-equivalence suite
 * (cfi.equivalence.fuzz.test.ts) that pins it against the parsed oracle.
 */
export {
    stripCfiWrapper,
    parseCfiRange,
    preprocessBlockRoots,
    parseCfiTokens,
    serializeCfiTokens,
} from './parse';
export type {
    CfiRangeData,
    PreprocessedRoot,
    CfiToken,
    CfiStepToken,
    CfiOffsetToken,
    CfiIndirectionToken,
    CfiRangeCommaToken,
} from './parse';

export {
    CFI_STEP_SEPARATORS,
    cfiContains,
    cfiContainsParsed,
    getParentCfi,
    getParentCfiParsed,
} from './contains';

export { mergeCfiSlow, generateCfiRange, mergeCfiRanges, tryFastMergeCfi } from './merge';

export { generateEpubCfi } from './generate';

export { groupSegmentsByRoot, attributeMarkersToGroups } from './group';
export type { CfiGroup, CfiSegment } from './group';

export { snapCfiToSentence } from './snap';
export type { CfiRangeResolver } from './snap';

export { CfiComparator, parseCfiPoint, tryParseCfiPoint, cfiFromRange } from './epubcfiShim';
export type { ParsedCfiPoint } from './epubcfiShim';
