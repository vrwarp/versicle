/**
 * The ONE Bible-lexicon preference resolution: per-book preference wins;
 * 'default' defers to the global setting. Used by the queue-building path
 * (abbreviation injection) and the system-lexicon provider.
 */
export type BiblePreference = 'on' | 'off' | 'default';

export function resolveBiblePreference(perBook: BiblePreference | undefined, globalEnabled: boolean): boolean {
    const pref = perBook ?? 'default';
    return pref === 'on' || (pref === 'default' && globalEnabled);
}
