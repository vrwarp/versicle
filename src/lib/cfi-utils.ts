/**
 * @deprecated Re-export shim over the canonical CFI kernel
 * (src/kernel/cfi/ — Phase 5c, phase5-tts-strangler.md §5c.4).
 *
 * DELETION DEADLINE: Phase 6 (reader strangler). The remaining importers are
 * reader-side (ReaderView, ReadingHistoryPanel, useReadingStateStore); they
 * migrate to the kernel together with the ReaderEngine port work. TTS-side
 * code imports the kernel directly — do not add new imports of this module.
 */
export {
    stripCfiWrapper,
    parseCfiRange,
    preprocessBlockRoots,
    cfiContains,
    getParentCfi,
    mergeCfiSlow,
    generateCfiRange,
    mergeCfiRanges,
    tryFastMergeCfi,
    generateEpubCfi,
    snapCfiToSentence,
} from '@kernel/cfi';
export type { CfiRangeData, PreprocessedRoot } from '@kernel/cfi';
