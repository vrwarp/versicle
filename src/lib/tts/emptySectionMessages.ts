/**
 * Spoken filler for sections with no readable text — DETERMINISTIC and keyed
 * by the book's language (ADR docs/adr/0001-i18n-strategy.md). One fixed
 * message per language family keeps zh voices from speaking English and avoids
 * fragmenting the audio cache (cache keys are content-addressed), which
 * randomized strings would do. Worker-importable: a plain module catalog, no
 * i18n runtime.
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
