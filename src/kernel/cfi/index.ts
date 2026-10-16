/**
 * src/kernel/cfi — the canonical CFI algebra (contract C12 / master plan §2
 * rule 1).
 *
 * Kernel admission: zero internal imports (epubjs's CFI submodule is the one
 * external dependency, quarantined in ./epubcfiShim) and ≥2 consuming
 * domains — TTS (segmenter, dragnet, table adaptation) and the reader
 * (ReadingSessionRecorder, ReadingHistoryPanel, useReadingStateStore, the
 * ReaderEngine as CfiRangeResolver).
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
export {
    cfiContains,
    cfiContainsParsed,
    getParentCfi,
    getParentCfiParsed,
} from './contains';

export { mergeCfiSlow, generateCfiRange, mergeCfiRanges, tryFastMergeCfi } from './merge';

export { generateEpubCfi } from './generate';

export { groupSegmentsByRoot, attributeMarkersToGroups } from './group';
export type { CfiGroup } from './group';

export { snapCfiToSentence } from './snap';
export type { CfiRangeResolver } from './snap';

export { CfiComparator, tryParseCfiPoint } from './epubcfiShim';
export type { ParsedCfiPoint } from './epubcfiShim';
