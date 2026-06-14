/**
 * The ONE Bible-lexicon preference resolution (Phase 5c;
 * phase5-tts-strangler.md §5c.3): per-book preference wins; 'default' defers
 * to the global setting. Used by the queue-building path (abbreviation
 * injection) and the lexicon assembler — previously duplicated in
 * AudioContentPipeline and LexiconService.
 */
export type BiblePreference = 'on' | 'off' | 'default';

export function resolveBiblePreference(perBook: BiblePreference | undefined, globalEnabled: boolean): boolean {
    const pref = perBook ?? 'default';
    return pref === 'on' || (pref === 'default' && globalEnabled);
}
