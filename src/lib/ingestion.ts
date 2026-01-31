import ePub from 'epubjs';
import type { NavigationItem } from '../types/db';
import { v4 as uuidv4 } from 'uuid';
import imageCompression from 'browser-image-compression';
import { getDB } from '../db/db';
import type { SectionMetadata, TTSContent, StaticBookManifest, StaticResource, UserInventoryItem, UserProgress, UserOverrides, TableImage, ReadingListEntry } from '../types/db';
import { getSanitizedBookMetadata } from '../db/validators';
import type { ExtractionOptions } from './tts';
import { extractContentOffscreen } from './offscreen-renderer';
import { CURRENT_BOOK_VERSION } from './constants';
import { extractCoverPalette } from './cover-palette';
import { createLogger } from './logger';

const logger = createLogger('Ingestion');

export { extractCoverPalette } from './cover-palette';

function cheapHash(buffer: ArrayBuffer): string {
    const view = new Uint8Array(buffer);
    let hash = 5381;
    for (let i = 0; i < view.length; i++) {
        hash = ((hash << 5) + hash) + view[i]; /* hash * 33 + c */
    }
    return (hash >>> 0).toString(16);
}

export async function generateFileFingerprint(
    file: Blob,
    metadata: { title: string; author: string; filename: string }
): Promise<string> {
    const metaString = `${metadata.filename}-${metadata.title}-${metadata.author}`;
    const headSize = Math.min(4096, file.size);
    const head = await file.slice(0, headSize).arrayBuffer();
    const tail = await file.slice(Math.max(0, file.size - 4096), file.size).arrayBuffer();
    return `${metaString}-${cheapHash(head)}-${cheapHash(tail)}`;
}

export async function validateZipSignature(file: File): Promise<boolean> {
    try {
        const buffer = await file.slice(0, 4).arrayBuffer();
        const view = new DataView(buffer);
        return view.getUint8(0) === 0x50 &&
            view.getUint8(1) === 0x4B &&
            view.getUint8(2) === 0x03 &&
            view.getUint8(3) === 0x04;
    } catch (e) {
        logger.error("File validation failed", e);
        return false;
    }
}

export async function reprocessBook(bookId: string): Promise<void> {
    const db = await getDB();
    // v18: Get from static_resources
    const resource = await db.get('static_resources', bookId);
    const file = resource?.epubBlob;

    if (!file) {
        throw new Error(`Book source file not found for ID: ${bookId}`);
    }

    const fileBlob = file instanceof Blob ? file : new Blob([file]);
    const chapters = await extractContentOffscreen(fileBlob, {});

    const syntheticToc: NavigationItem[] = [];
    const sections: SectionMetadata[] = [];
    const ttsContentBatches: TTSContent[] = [];
    const tableBatches: TableImage[] = [];
    let totalChars = 0;

    chapters.forEach((chapter, i) => {
        syntheticToc.push({
            id: `syn-toc-${i}`,
            href: chapter.href,
            label: chapter.title || `Chapter ${i + 1}`
        });

        sections.push({
            id: `${bookId}-${chapter.href}`,
            bookId,
            sectionId: chapter.href,
            characterCount: chapter.textContent.length,
            playOrder: i
        });
        totalChars += chapter.textContent.length;

        if (chapter.sentences.length > 0) {
            ttsContentBatches.push({
                id: `${bookId}-${chapter.href}`,
                bookId,
                sectionId: chapter.href,
                sentences: chapter.sentences
            });
        }

        if (chapter.tables && chapter.tables.length > 0) {
            chapter.tables.forEach(table => {
                tableBatches.push({
                    id: `${bookId}-${table.cfi}`,
                    bookId,
                    sectionId: chapter.href,
                    cfi: table.cfi,
                    imageBlob: table.imageBlob
                });
            });
        }
    });

    const tx = db.transaction(['static_manifests', 'static_structure', 'cache_tts_preparation', 'cache_table_images'], 'readwrite');

    // Update Metadata
    const manStore = tx.objectStore('static_manifests');
    const manifest = await manStore.get(bookId);
    if (manifest) {
        manifest.totalChars = totalChars;
        // manifest.syntheticToc? v18 puts this in static_structure.
        manifest.schemaVersion = CURRENT_BOOK_VERSION;
        await manStore.put(manifest);
    }

    // Update Structure
    const structStore = tx.objectStore('static_structure');
    await structStore.put({
        bookId,
        toc: syntheticToc,
        spineItems: sections.map(s => ({
            id: s.sectionId,
            characterCount: s.characterCount,
            index: s.playOrder
        }))
    });

    // Update TTS Preparation (Cache)
    // Clean up old entries first
    const prepStore = tx.objectStore('cache_tts_preparation');
    // Requires index 'by_bookId' which we added
    const prepIndex = prepStore.index('by_bookId');
    const keys = await prepIndex.getAllKeys(bookId);
    for (const key of keys) {
        await prepStore.delete(key);
    }

    for (const batch of ttsContentBatches) {
        await prepStore.put({
            id: batch.id,
            bookId: batch.bookId,
            sectionId: batch.sectionId,
            sentences: batch.sentences
        });
    }

    // Update Table Images (Cache)
    const tableStore = tx.objectStore('cache_table_images');
    const tableIndex = tableStore.index('by_bookId');
    const tableKeys = await tableIndex.getAllKeys(bookId);
    for (const key of tableKeys) {
        await tableStore.delete(key);
    }

    for (const table of tableBatches) {
        await tableStore.put(table);
    }

    await tx.done;
}

export interface BookExtractionData {
    bookId: string;
    manifest: StaticBookManifest;
    resource: StaticResource;
    structure: {
        bookId: string;
        toc: NavigationItem[];
        spineItems: {
            id: string;
            characterCount: number;
            index: number;
        }[];
    };
    inventory: UserInventoryItem;
    progress: UserProgress;
    overrides: UserOverrides;
    readingListEntry: ReadingListEntry;
    ttsContentBatches: TTSContent[];
    tableBatches: TableImage[];
}

export async function extractBookData(
    file: File,
    ttsOptions?: ExtractionOptions,
    onProgress?: (progress: number, message: string) => void
): Promise<BookExtractionData> {
    const isValid = await validateZipSignature(file);
    if (!isValid) {
        throw new Error("Invalid file format. File must be a valid EPUB (ZIP archive).");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const book = (ePub as any)(file);
    await book.ready;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = await (book.loaded as any).metadata;
    const coverUrl = await book.coverUrl();

    let coverBlob: Blob | undefined;
    let thumbnailBlob: Blob | undefined;
    let coverPalette: number[] | undefined;

    if (coverUrl) {
        try {
            const response = await fetch(coverUrl);
            coverBlob = await response.blob();
            if (coverBlob) {
                try {
                    thumbnailBlob = await imageCompression(coverBlob as File, {
                        maxSizeMB: 0.5,
                        maxWidthOrHeight: 800,
                        useWebWorker: true,
                    });
                } catch (error) {
                    logger.warn('Failed to compress cover image, using original:', error);
                    thumbnailBlob = coverBlob;
                }
            }
        } catch (error) {
            logger.warn('Failed to retrieve cover blob:', error);
        }
    }

    // Generate palette if we have any cover image
    if (thumbnailBlob || coverBlob) {
        coverPalette = await extractCoverPalette((thumbnailBlob || coverBlob)!);
        if (coverPalette.length === 0) coverPalette = undefined;
    }

    book.destroy();

    const chapters = await extractContentOffscreen(file, ttsOptions, onProgress);

    const bookId = uuidv4();
    const syntheticToc: NavigationItem[] = [];
    const sections: SectionMetadata[] = [];
    const ttsContentBatches: TTSContent[] = [];
    const tableBatches: TableImage[] = [];
    let totalChars = 0;

    chapters.forEach((chapter, i) => {
        syntheticToc.push({
            id: `syn-toc-${i}`,
            href: chapter.href,
            label: chapter.title || `Chapter ${i + 1}`
        });

        sections.push({
            id: `${bookId}-${chapter.href}`,
            bookId,
            sectionId: chapter.href,
            characterCount: chapter.textContent.length,
            playOrder: i
        });
        totalChars += chapter.textContent.length;

        if (chapter.sentences.length > 0) {
            ttsContentBatches.push({
                id: `${bookId}-${chapter.href}`,
                bookId,
                sectionId: chapter.href,
                sentences: chapter.sentences
            });
        }

        if (chapter.tables && chapter.tables.length > 0) {
            chapter.tables.forEach(table => {
                tableBatches.push({
                    id: `${bookId}-${table.cfi}`,
                    bookId,
                    sectionId: chapter.href,
                    cfi: table.cfi,
                    imageBlob: table.imageBlob
                });
            });
        }
    });

    const fileHash = await generateFileFingerprint(file, {
        title: metadata.title || 'Untitled',
        author: metadata.creator || 'Unknown Author',
        filename: file.name
    });

    // Construct Sanitized Metadata Candidate
    const candidateMetadata = {
        id: bookId,
        title: metadata.title || 'Untitled',
        author: metadata.creator || 'Unknown Author',
        description: metadata.description || '',
        addedAt: Date.now(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const check = getSanitizedBookMetadata(candidateMetadata as any);
    if (check) {
        const s = check.sanitized;
        candidateMetadata.title = s.title;
        candidateMetadata.author = s.author;
        candidateMetadata.description = s.description;
        if (check.wasModified) {
            logger.warn(`Metadata sanitized for "${candidateMetadata.title}":`, check.modifications);
        }
    }

    const manifest: StaticBookManifest = {
        bookId,
        title: candidateMetadata.title,
        author: candidateMetadata.author,
        description: candidateMetadata.description,
        fileHash,
        fileSize: file.size,
        totalChars,
        schemaVersion: CURRENT_BOOK_VERSION,
        isbn: undefined,
        coverBlob: thumbnailBlob || coverBlob
    };

    const resource: StaticResource = {
        bookId,
        epubBlob: file
    };

    const structure = {
        bookId,
        toc: syntheticToc,
        spineItems: sections.map(s => ({
            id: s.sectionId,
            characterCount: s.characterCount,
            index: s.playOrder
        }))
    };

    const inventory: UserInventoryItem = {
        bookId,
        title: candidateMetadata.title,
        author: candidateMetadata.author,
        addedAt: candidateMetadata.addedAt,
        sourceFilename: file.name,
        tags: [],
        status: 'unread',
        lastInteraction: Date.now(),
        coverPalette
    };

    const progress: UserProgress = {
        bookId,
        percentage: 0,
        lastRead: 0,
        completedRanges: []
    };

    const overrides: UserOverrides = {
        bookId,
        lexicon: []
    };

    const readingListEntry: ReadingListEntry = {
        filename: file.name,
        title: candidateMetadata.title,
        author: candidateMetadata.author,
        isbn: undefined,
        percentage: 0,
        lastUpdated: Date.now(),
        status: 'to-read',
        rating: undefined
    };

    return {
        bookId,
        manifest,
        resource,
        structure,
        inventory,
        progress,
        overrides,
        readingListEntry,
        ttsContentBatches,
        tableBatches
    };
}

/**
 * Lightweight metadata extraction for duplicate/ghost detection.
 * Does NOT perform full content extraction.
 */
export async function extractBookMetadata(file: File): Promise<{
    title: string;
    author: string;
    description: string;
    fileHash: string;
    coverBlob?: Blob;
    coverPalette?: number[];
}> {
    const isValid = await validateZipSignature(file);
    if (!isValid) {
        throw new Error("Invalid file format. File must be a valid EPUB (ZIP archive).");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const book = (ePub as any)(file);
    await book.ready;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = await (book.loaded as any).metadata;
    const coverUrl = await book.coverUrl();

    let coverBlob: Blob | undefined;
    let thumbnailBlob: Blob | undefined;
    let coverPalette: number[] | undefined;

    if (coverUrl) {
        try {
            const response = await fetch(coverUrl);
            coverBlob = await response.blob();
            if (coverBlob) {
                try {
                    thumbnailBlob = await imageCompression(coverBlob as File, {
                        maxSizeMB: 0.5,
                        maxWidthOrHeight: 800,
                        useWebWorker: true,
                    });
                } catch (error) {
                    logger.warn('Failed to compress cover image, using original:', error);
                    thumbnailBlob = coverBlob;
                }
            }
        } catch (error) {
            logger.warn('Failed to retrieve cover blob:', error);
        }
    }

    // Generate palette if we have any cover image
    if (thumbnailBlob || coverBlob) {
        coverPalette = await extractCoverPalette((thumbnailBlob || coverBlob)!);
        if (coverPalette.length === 0) coverPalette = undefined;
    }

    book.destroy();

    const fileHash = await generateFileFingerprint(file, {
        title: metadata.title || 'Untitled',
        author: metadata.creator || 'Unknown Author',
        filename: file.name
    });

    // Sanitization check
    const candidateMetadata = {
        title: metadata.title || 'Untitled',
        author: metadata.creator || 'Unknown Author',
        description: metadata.description || '',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const check = getSanitizedBookMetadata(candidateMetadata as any);
    if (check) {
        candidateMetadata.title = check.sanitized.title;
        candidateMetadata.author = check.sanitized.author;
        candidateMetadata.description = check.sanitized.description;
    }

    return {
        title: candidateMetadata.title,
        author: candidateMetadata.author,
        description: candidateMetadata.description,
        fileHash,
        coverBlob: thumbnailBlob || coverBlob,
        coverPalette
    };
}

// Backward compatibility: keep for external callers not yet updated (if any),
// but implemented via extraction + warning.
// Note: In strict refactor, we would update all callers. Currently only DBService is caller.
/* eslint-disable @typescript-eslint/no-unused-vars */
export async function processEpub(
    _file: File,
    _ttsOptions?: ExtractionOptions,
    _onProgress?: (progress: number, message: string) => void
): Promise<string> {
    throw new Error("processEpub is deprecated. Use extractBookData and DBService.ingestBook.");
}
/* eslint-enable @typescript-eslint/no-unused-vars */
