/**
 * A shared cache for Intl.Segmenter instances to avoid expensive re-creation.
 * Creating a new Intl.Segmenter instance is a heavy operation (loading locale data).
 * We cache instances by locale.
 */

const cache = new Map<string, Intl.Segmenter>();

/**
 * Retrieves a cached Intl.Segmenter instance for the given locale.
 *
 * @param locale - The locale string (e.g., 'en', 'es'). Defaults to 'en'.
 * @returns The cached Intl.Segmenter instance, or undefined if Intl.Segmenter is not supported.
 */
export function getCachedSegmenter(locale: string = 'en'): Intl.Segmenter | undefined {
    if (typeof Intl === 'undefined' || !Intl.Segmenter) {
        return undefined;
    }

    if (!cache.has(locale)) {
        try {
            cache.set(locale, new Intl.Segmenter(locale, { granularity: 'sentence' }));
        } catch (e) {
            console.warn(`Failed to create Intl.Segmenter for locale "${locale}"`, e);
            return undefined;
        }
    }
    return cache.get(locale);
}

/**
 * Clears the segmenter cache.
 * Useful for testing or memory management if needed.
 */
export function clearSegmenterCache(): void {
    cache.clear();
}
