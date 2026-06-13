/**
 * Spoken filler for sections with no readable text — DETERMINISTIC and keyed
 * by the book's language (Phase 5c; phase5-tts-strangler.md §5c.2 and ADR
 * docs/adr/0001-i18n-strategy.md): the legacy pipeline picked one of ten
 * randomized English strings, which spoke English through zh voices and
 * fragmented the audio cache (cache keys are content-addressed). One fixed
 * message per language family fixes both. Worker-importable: a plain module
 * catalog, no i18n runtime.
 */
const CATALOG: Record<string, string> = {
    en: 'There is no text to read here.',
    zh: '此章節沒有可朗讀的內容。',
};

/** The single deterministic filler message for a book language (BCP-47 tag or bare code). */
export function emptySectionMessage(language: string | undefined): string {
    const primary = (language || 'en').toLowerCase().split(/[-_]/)[0];
    return CATALOG[primary] ?? CATALOG.en;
}
