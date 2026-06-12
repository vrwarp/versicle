import ePub from 'epubjs';
import type { NavigationItem } from '~types/db';
import { v4 as uuidv4 } from 'uuid';
import imageCompression from 'browser-image-compression';
import { bookContent } from '@data/repos/bookContent';
import type { SectionMetadata, CacheTtsPreparation, StaticBookManifest, StaticResource, UserInventoryItem, UserProgress, UserOverrides, TableImage, ReadingListEntry, PerceptualPalette, BookMetadata } from '~types/db';
import type { ProcessedChapter } from './offscreen-renderer';
import { sanitizeMetadata } from './sanitizer';
import { TTS_EXTRACTION_VERSION, type ExtractionOptions } from './ingestion/sentence-extraction';
import { extractContentOffscreen } from './offscreen-renderer';
import { CURRENT_BOOK_VERSION } from './constants';
import { extractCoverPalette } from './cover-palette';
import { createLogger } from './logger';
import { normalizeLanguageCode } from './language-utils';
import { localFetch } from '@kernel/net';

const logger = createLogger('Ingestion');

// ── Metadata validation & sanitization (sanitize-at-ingest boundary) ─────────
// Moved VERBATIM from src/db/validators.ts (Phase 3, D4: the hand-rolled
// validator module dissolves into its only consumer — this file — next to the
// ingest boundary it guards; persisted-row validation is src/data/rows/).

/**
 * Validates if an object conforms to the BookMetadata interface.
 * Logs warnings for missing required fields.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validateBookMetadata(data: any): data is BookMetadata {
  if (!data || typeof data !== 'object') {
    console.warn('DB Validation: Invalid record (not an object)', data);
    return false;
  }

  const missingFields: string[] = [];

  if (typeof data.id !== 'string' || data.id.trim() === '') {
    missingFields.push('id');
  }

  // Ingestion sets default title/author, but we should strictly check they exist as strings
  if (typeof data.title !== 'string') {
    missingFields.push('title');
  }

  if (typeof data.author !== 'string') {
    missingFields.push('author');
  }

  if (typeof data.addedAt !== 'number') {
    missingFields.push('addedAt');
  }

  if (missingFields.length > 0) {
    console.warn(`DB Validation: Record missing required fields: ${missingFields.join(', ')}`, data);
    return false;
  }

  return true;
}

/**
 * Sanitizes a string by stripping HTML, trimming, and enforcing a maximum length.
 * Uses DOMPurify (via sanitizer lib) for robust cleaning.
 *
 * @param input - The string to sanitize.
 * @param maxLength - The maximum allowed length (default: 255).
 * @returns The sanitized string.
 */
export function sanitizeString(input: string, maxLength: number = 255): string {
    if (typeof input !== 'string') return '';

    // Use the robust DOMPurify-based sanitizer
    const text = sanitizeMetadata(input);

    // Fallback if sanitizer returns empty but input wasn't (unlikely for plain text, but possible if it was all tags)
    // If input was "<b>bold</b>", text is "bold".

    return text.trim().slice(0, maxLength);
}

export interface SanitizationResult {
    sanitized: BookMetadata;
    wasModified: boolean;
    modifications: string[];
}

/**
 * Checks book metadata for sanitization needs and returns the sanitized version with a report of changes.
 * Returns null if the input is invalid.
 * @param data - The raw data to sanitize.
 * @returns SanitizationResult or null.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSanitizedBookMetadata(data: any): SanitizationResult | null {
    if (!validateBookMetadata(data)) return null;

    const modifications: string[] = [];

    const titleSanitized = sanitizeString(data.title, 500);
    if (titleSanitized !== data.title) {
        modifications.push(`Title sanitized (HTML removed or truncated by ${data.title.length - titleSanitized.length} characters)`);
    }

    const authorSanitized = sanitizeString(data.author, 255);
    if (authorSanitized !== data.author) {
        modifications.push(`Author sanitized (HTML removed or truncated by ${data.author.length - authorSanitized.length} characters)`);
    }

    let descriptionSanitized = data.description;
    if (typeof data.description === 'string') {
        descriptionSanitized = sanitizeString(data.description, 2000);
        if (descriptionSanitized !== data.description) {
            modifications.push(`Description sanitized (HTML removed or truncated by ${data.description.length - descriptionSanitized.length} characters)`);
        }
    }

    const sanitized: BookMetadata = {
        ...data,
        title: titleSanitized,
        author: authorSanitized,
        description: descriptionSanitized,
    };

    return {
        sanitized,
        wasModified: modifications.length > 0,
        modifications
    };
}

function toCacheTtsPrep(bookId: string, chapter: ProcessedChapter): CacheTtsPreparation {
    return {
        id: `${bookId}-${chapter.href}`,
        bookId,
        sectionId: chapter.href,
        sentences: chapter.sentences,
        citationMarkers: chapter.citationMarkers?.length > 0 ? chapter.citationMarkers : undefined,
        extractionVersion: TTS_EXTRACTION_VERSION,
    };
}

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
    // v18: Get from static_resources
    const file = await bookContent.getBookFile(bookId);

    if (!file) {
        throw new Error(`Book source file not found for ID: ${bookId}`);
    }

    const fileBlob = file instanceof Blob ? file : new Blob([file]);

    // Capture Real TOC
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const book = (ePub as any)(fileBlob, { replacements: 'none' });
    await book.ready;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = await (book.loaded as any).metadata;
    const rawLanguage = normalizeLanguageCode(metadata.language || metadata.lang);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const navigation = await (book.loaded as any).navigation;
    const realToc: NavigationItem[] = navigation ? navigation.toc : [];

    // Re-extract cover palette if we can find a cover
    let reprocessedPalette: number[] | undefined;
    let reprocessedPerceptualPalette: PerceptualPalette | undefined;
    try {
        const coverUrl = await book.coverUrl();
        if (coverUrl) {
            const response = await localFetch(coverUrl);
            const coverBlob = await response.blob();
            if (coverBlob) {
                const result = await extractCoverPalette(coverBlob);
                if (result.palette && result.palette.length > 0) {
                    reprocessedPalette = result.palette;
                }
                if (result.perceptualPalette) {
                    reprocessedPerceptualPalette = result.perceptualPalette;
                }
            }
        }
    } catch (e) {
        logger.warn("Failed to update cover palette during reprocessing", e);
    }

    await book.opened.catch(() => { });
    book.destroy();

    const { chapters, baseFontSize, baseLineHeight } = await extractContentOffscreen(fileBlob, { locale: rawLanguage });

    const syntheticToc: NavigationItem[] = [];
    const sections: SectionMetadata[] = [];
    const ttsContentBatches: CacheTtsPreparation[] = [];
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
            playOrder: i,
            title: chapter.title || `Chapter ${i + 1}`
        });
        totalChars += chapter.textContent.length;

        if (chapter.sentences.length > 0) {
            ttsContentBatches.push(toCacheTtsPrep(bookId, chapter));
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

    // ── Persist the reprocessed book ─────────────────────────────────────────────────────
    // The WebKit-safe write discipline (Blob → ArrayBuffer conversion before
    // the transaction; reads hoisted out; one synchronous gated transaction)
    // lives in bookContent.replaceDerivedContent — the repo absorbed this
    // function's raw 4-store transaction in Phase 3 (D5.3).
    const manifest = await bookContent.getManifest(bookId);

    if (manifest) {
        manifest.totalChars = totalChars;
        // manifest.syntheticToc? v18 puts this in static_structure.
        manifest.schemaVersion = CURRENT_BOOK_VERSION;
        manifest.baseFontSize = baseFontSize;
        manifest.baseLineHeight = baseLineHeight;
        if (reprocessedPalette) manifest.coverPalette = reprocessedPalette;
        if (reprocessedPerceptualPalette) manifest.perceptualPalette = reprocessedPerceptualPalette;
    }

    await bookContent.replaceDerivedContent(bookId, {
        manifest,
        structure: {
            bookId,
            toc: realToc.length > 0 ? realToc : syntheticToc,
            spineItems: sections.map(s => ({
                id: s.sectionId,
                characterCount: s.characterCount,
                index: s.playOrder
            }))
        },
        ttsPrep: ttsContentBatches,
        tableImages: tableBatches,
    });

    // Update Yjs store (inventory) if palette changed
    if (reprocessedPalette || reprocessedPerceptualPalette) {
        const { useBookStore } = await import('@store/useBookStore');
        const updateBook = useBookStore.getState().updateBook;
        if (updateBook) {
            updateBook(bookId, {
                coverPalette: reprocessedPalette,
                perceptualPalette: reprocessedPerceptualPalette
            });
        }
    }
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
    ttsContentBatches: CacheTtsPreparation[];
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
    const book = (ePub as any)(file, { replacements: 'none' });
    await book.ready;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = await (book.loaded as any).metadata;
    const coverUrl = await book.coverUrl();

    // Extract language (ISO 639-1), normalize, default to 'en'
    const rawLanguage = normalizeLanguageCode(metadata.language || metadata.lang);

    let coverBlob: Blob | undefined;
    let thumbnailBlob: Blob | undefined;
    let coverPalette: number[] | undefined;
    let perceptualPalette: PerceptualPalette | undefined;

    if (coverUrl) {
        try {
            const response = await localFetch(coverUrl);
            coverBlob = await response.blob();
            if (coverBlob) {
                try {
                    thumbnailBlob = await imageCompression(coverBlob as File, {
                        maxSizeMB: 0.1,
                        maxWidthOrHeight: 600,
                        useWebWorker: true,
                        fileType: 'image/webp',
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
        const result = await extractCoverPalette((thumbnailBlob || coverBlob)!);
        coverPalette = result.palette;
        perceptualPalette = result.perceptualPalette;
        if (coverPalette.length === 0) coverPalette = undefined;
    }

    // Extract Navigation (TOC)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const navigation = await (book.loaded as any).navigation;
    const realToc: NavigationItem[] = navigation ? navigation.toc : [];

    await book.opened.catch(() => { });
    book.destroy();

    const optionsWithLocale = { ...ttsOptions, locale: rawLanguage };
    const { chapters, baseFontSize, baseLineHeight } = await extractContentOffscreen(file, optionsWithLocale, onProgress);

    const bookId = uuidv4();
    const syntheticToc: NavigationItem[] = [];
    const sections: SectionMetadata[] = [];
    const ttsContentBatches: CacheTtsPreparation[] = [];
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
            playOrder: i,
            title: chapter.title || `Chapter ${i + 1}`
        });
        totalChars += chapter.textContent.length;

        if (chapter.sentences.length > 0) {
            ttsContentBatches.push(toCacheTtsPrep(bookId, chapter));
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
        coverBlob: thumbnailBlob || coverBlob,
        coverPalette,
        perceptualPalette,
        language: rawLanguage,
        baseFontSize,
        baseLineHeight
    };

    const resource: StaticResource = {
        bookId,
        epubBlob: file
    };

    const structure = {
        bookId,
        toc: realToc.length > 0 ? realToc : syntheticToc,
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
        coverPalette,
        perceptualPalette,
        language: rawLanguage
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
    perceptualPalette?: PerceptualPalette;
}> {
    const isValid = await validateZipSignature(file);
    if (!isValid) {
        throw new Error("Invalid file format. File must be a valid EPUB (ZIP archive).");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const book = (ePub as any)(file, { replacements: 'none' });
    await book.ready;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = await (book.loaded as any).metadata;
    const coverUrl = await book.coverUrl();

    let coverBlob: Blob | undefined;
    let thumbnailBlob: Blob | undefined;
    let coverPalette: number[] | undefined;
    let perceptualPalette: PerceptualPalette | undefined;

    if (coverUrl) {
        try {
            const response = await localFetch(coverUrl);
            coverBlob = await response.blob();
            if (coverBlob) {
                try {
                    thumbnailBlob = await imageCompression(coverBlob as File, {
                        maxSizeMB: 0.1,
                        maxWidthOrHeight: 600,
                        useWebWorker: true,
                        fileType: 'image/webp',
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
        const result = await extractCoverPalette((thumbnailBlob || coverBlob)!);
        coverPalette = result.palette;
        perceptualPalette = result.perceptualPalette;
        if (coverPalette.length === 0) coverPalette = undefined;
    }

    await book.opened.catch(() => { });
    book.destroy();

    const fileHash = await generateFileFingerprint(file, {
        title: metadata.title || 'Untitled',
        author: metadata.creator || 'Unknown Author',
        filename: file.name
    });

    // Sanitization check
    const candidateMetadata = {
        id: 'temp-validation-id', // Dummy ID for validation
        title: metadata.title || 'Untitled',
        author: metadata.creator || 'Unknown Author',
        description: metadata.description || '',
        addedAt: Date.now(), // Dummy date for validation
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
        coverPalette,
        perceptualPalette
    };
}
