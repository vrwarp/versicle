/**
 * Sentence snapping — locale-aware since the Phase 5c kernel move
 * (phase5-tts-strangler.md §5c.4, i18n graft): the segmenter locale is
 * threaded from the book's language instead of the legacy hardcoded 'en'.
 * TTS consumers pass the language explicitly; the reader (which adopts the
 * kernel in P6) gets it derived from the epubjs Book's OPF metadata.
 */
import type { Book } from 'epubjs';
import { getCachedSegmenter } from '../locale/segmenterCache';
import { cfiFromRange } from './epubcfiShim';

/** Best-effort book language from the epubjs OPF metadata; undefined when absent. */
function bookLanguage(book: Book): string | undefined {
    const packaging = (book as unknown as { packaging?: { metadata?: { language?: string } } }).packaging;
    const lang = packaging?.metadata?.language;
    return lang && typeof lang === 'string' ? lang : undefined;
}

/**
 * Snaps a CFI to the nearest sentence boundary.
 *
 * @param book - The epub.js Book instance.
 * @param cfi - The CFI to snap.
 * @param language - BCP-47 language for sentence segmentation. Defaults to the
 *   book's OPF language, then 'en' (the pre-5c behavior was a hardcoded 'en').
 * @returns The snapped CFI, or the original if snapping failed.
 *
 * @warning This function is asynchronous and relies on the Book instance being active.
 * Do NOT use this in component cleanup/unmount phases where the Book instance might be destroyed.
 */
export async function snapCfiToSentence(book: Book, cfi: string, language?: string): Promise<string> {
    try {
        // Lifecycle safety check: ensure book instance is valid
        // Prevents crash during reader destruction if called late
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!book || !(book as any).spine) {
            console.warn('snapCfiToSentence: Book instance is destroyed or invalid. Returning raw CFI.');
            return cfi;
        }

        if (!cfi || !cfi.includes('!')) return cfi;

        const range = await book.getRange(cfi);
        if (!range) return cfi;

        const startNode = range.startContainer;
        const startOffset = range.startOffset;

        if (startNode.nodeType !== Node.TEXT_NODE) {
            return cfi;
        }

        const text = startNode.textContent || '';

        // Use cached segmenter if available (locale-aware; kills the hardcoded 'en')
        const segmenter = getCachedSegmenter(language || bookLanguage(book) || 'en');
        if (segmenter) {
            const segments = segmenter.segment(text);
            let bestStart = 0;
            for (const segment of segments) {
                if (segment.index <= startOffset) {
                    bestStart = segment.index;
                } else {
                    break;
                }
            }

            if (bestStart !== startOffset) {
                const newRange = document.createRange();
                newRange.setStart(startNode, bestStart);
                newRange.setEnd(startNode, bestStart);

                let baseCfi = cfi.split('!')[0] + '!';
                if (baseCfi.startsWith('epubcfi(')) {
                    baseCfi = baseCfi.slice(8);
                }
                const newCfi = cfiFromRange(newRange, baseCfi);
                return newCfi;
            }
        }

        return cfi;
    } catch (e) {
        console.warn('snapCfiToSentence failed', e);
        return cfi;
    }
}
