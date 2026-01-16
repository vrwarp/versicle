import { getDB } from '../../db/db';
import { useBookStore } from '../../store/useLibraryStore';
import { extractCoverPalette } from '../ingestion';
import { yDoc } from '../../store/yjs-provider';

/**
 * Backfills cover palettes for existing books that lack them.
 * This is a one-time migration for the Ghost Book feature.
 */
export async function backfillCoverPalettes(): Promise<void> {
    const preferencesMap = yDoc.getMap('preferences');
    const backfillComplete = preferencesMap.get('ghost_book_palette_v2_backfill_complete');

    if (backfillComplete === true) {
        return;
    }

    console.log('[Backfill] Checking for missing or outdated cover palettes...');

    const books = useBookStore.getState().books;
    const db = await getDB();
    let updatedCount = 0;

    const updates: Record<string, number[]> = {};

    for (const book of Object.values(books)) {
        // Regenerate if missing OR if old 4-color format
        if (!book.coverPalette || book.coverPalette.length !== 5) {
            try {
                // Try to get cover from static_manifests (fastest)
                const manifest = await db.get('static_manifests', book.bookId);
                const blob = manifest?.coverBlob;

                if (blob) {
                    const palette = await extractCoverPalette(blob);
                    if (palette.length === 5) {
                        updates[book.bookId] = palette;
                        updatedCount++;
                    }
                }
            } catch (e) {
                console.warn(`[Backfill] Failed to process book ${book.bookId}:`, e);
            }
        }
    }

    if (updatedCount > 0) {
        console.log(`[Backfill] Generating palettes for ${updatedCount} books...`);

        // Update Yjs (via store actions) to ensure persistence and sync.
        // We use yDoc.transact to bundle the updates into a single transaction.
        yDoc.transact(() => {
            const store = useBookStore.getState();
            for (const [id, palette] of Object.entries(updates)) {
                 store.updateBook(id, { coverPalette: palette });
            }
        });

        console.log(`[Backfill] Successfully updated ${updatedCount} books.`);
    } else {
        console.log('[Backfill] No books needed palette generation.');
    }

    // Mark complete
    preferencesMap.set('ghost_book_palette_v2_backfill_complete', true);
}
