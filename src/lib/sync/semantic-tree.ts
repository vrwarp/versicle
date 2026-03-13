import { useBookStore } from '../../store/useBookStore';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { useLexiconStore } from '../../store/useLexiconStore';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { useReadingListStore } from '../../store/useReadingListStore';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { getDeviceId } from '../device-id';
import { createLogger } from '../logger';
import type { SyncManifest, UserProgress } from '../../types/db';

const logger = createLogger('SemanticTree');

/**
 * Utility function to gather human-readable semantic data from stores.
 * This is used as a passive payload inside the V2 Backup Manifest.
 */
export async function generateSemanticTree(): Promise<Partial<SyncManifest>> {
    logger.info('Generating semantic tree for passive backup payload...');

    const deviceId = getDeviceId();
    const data: Partial<SyncManifest> = {
        version: 1, // Semantic version is fixed
        lastUpdated: Date.now(),
        deviceId
    };

    // Collect library data
    const { books } = useBookStore.getState();
    data.books = {};

    for (const [bookId, book] of Object.entries(books)) {
        data.books[bookId] = {
            metadata: {
                id: bookId,
                title: book.title,
                author: book.author,
                addedAt: book.addedAt,
                coverPalette: book.coverPalette,
                filename: book.sourceFilename
            },
            history: {
                bookId,
                readRanges: [],
                sessions: [],
                lastUpdated: book.lastInteraction || Date.now()
            },
            annotations: []
        };
    }

    // Collect progress data
    const { progress } = useReadingStateStore.getState();
    for (const [bookId, deviceProgress] of Object.entries(progress)) {
        if (data.books[bookId]) {
            // Flatten per-device progress into history
            const entries = Object.values(deviceProgress as Record<string, UserProgress>);
            if (entries.length > 0) {
                // Take the max progress entry
                const maxEntry = entries.reduce((max, curr) =>
                    (curr.percentage || 0) > (max.percentage || 0) ? curr : max
                );
                data.books[bookId].history = {
                    bookId,
                    readRanges: maxEntry.completedRanges || [],
                    sessions: [],
                    lastUpdated: maxEntry.lastRead || Date.now()
                };

                // Add progress to metadata for compat
                data.books[bookId].metadata = {
                    ...data.books[bookId].metadata,
                    progress: maxEntry.percentage,
                    currentCfi: maxEntry.currentCfi
                };
            }
        }
    }

    // Collect annotations
    const { annotations } = useAnnotationStore.getState();
    for (const annotation of Object.values(annotations)) {
        if (data.books[annotation.bookId]) {
            data.books[annotation.bookId].annotations.push(annotation);
        }
    }

    // Collect lexicon rules
    const { rules } = useLexiconStore.getState();
    data.lexicon = Object.values(rules);

    // Collect reading list
    const { entries } = useReadingListStore.getState();
    data.readingList = entries;

    // Collect transient state
    data.transientState = {
        ttsPositions: {}
    };

    // Collect settings
    const {
        currentTheme, customTheme, fontFamily, fontSize, lineHeight,
        shouldForceFont, readerViewMode, libraryLayout
    } = usePreferencesStore.getState();

    data.settings = {
        theme: currentTheme,
        customTheme,
        fontFamily,
        fontSize,
        lineHeight,
        shouldForceFont,
        readerViewMode,
        libraryLayout
    };

    logger.info('Semantic tree generation complete.');

    return data;
}
