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

function cheapHash(buffer: ArrayBuffer): string {
    const view = new Uint8Array(buffer);
    let hash = 5381;
    for (let i = 0; i < view.length; i++) {
        hash = ((hash << 5) + hash) + view[i]; /* hash * 33 + c */
    }
    return (hash >>> 0).toString(16);
}

// --- Weighted K-Means Clustering Utils ---

interface Pixel {
    r: number;
    g: number;
    b: number;
    x: number;
    y: number;
    weight: number;
}

interface Point {
    x: number;
    y: number;
}

interface Color {
    r: number;
    g: number;
    b: number;
}

function packColor(c: Color): number {
    const r4 = (Math.round(c.r) >> 4) & 0xF;
    const g8 = Math.round(c.g) & 0xFF;
    const b4 = (Math.round(c.b) >> 4) & 0xF;
    return (r4 << 12) | (g8 << 4) | b4;
}

function distRGB(c1: Color, c2: Color): number {
    const dr = c1.r - c2.r;
    const dg = c1.g - c2.g;
    const db = c1.b - c2.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

function extractRegionColor(pixels: Pixel[], anchor: Point): Color {
    // 1. Pre-calculate weights (1.5f exponent)
    for (const p of pixels) {
        const dist = Math.sqrt(Math.pow(p.x - anchor.x, 2) + Math.pow(p.y - anchor.y, 2));
        p.weight = 1.0 / (1.0 + Math.pow(dist, 1.5));
    }

    // 2. Init Centroids (Deterministic)
    let c1: Color = { r: 0, g: 0, b: 0 };
    let c2: Color = { r: 0, g: 0, b: 0 };

    // Find max/min weight pixels
    let maxW = -1;
    let minW = Infinity;

    for (const p of pixels) {
        if (p.weight > maxW) {
            maxW = p.weight;
            c1 = { r: p.r, g: p.g, b: p.b };
        }
        if (p.weight < minW) {
            minW = p.weight;
            c2 = { r: p.r, g: p.g, b: p.b };
        }
    }

    // 3. Run K-Means (5 iterations)
    for (let i = 0; i < 5; i++) {
        let sum1 = { r: 0, g: 0, b: 0 };
        let sum2 = { r: 0, g: 0, b: 0 };
        let wSum1 = 0;
        let wSum2 = 0;

        for (const p of pixels) {
            // Assign to nearest centroid
            if (distRGB(p, c1) < distRGB(p, c2)) {
                sum1.r += p.r * p.weight;
                sum1.g += p.g * p.weight;
                sum1.b += p.b * p.weight;
                wSum1 += p.weight;
            } else {
                sum2.r += p.r * p.weight;
                sum2.g += p.g * p.weight;
                sum2.b += p.b * p.weight;
                wSum2 += p.weight;
            }
        }

        // Weighted Update
        if (wSum1 > 0) c1 = { r: sum1.r / wSum1, g: sum1.g / wSum1, b: sum1.b / wSum1 };
        if (wSum2 > 0) c2 = { r: sum2.r / wSum2, g: sum2.g / wSum2, b: sum2.b / wSum2 };

        // Store total weights for winner selection
        if (i === 4) {
            return wSum1 > wSum2 ? c1 : c2;
        }
    }

    return c1;
}

export async function extractCoverPalette(blob: Blob): Promise<number[]> {
    try {
        const bitmap = await createImageBitmap(blob);
        let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

        const size = 16; // 16x16 grid

        if (typeof OffscreenCanvas !== 'undefined') {
            const canvas = new OffscreenCanvas(size, size);
            ctx = canvas.getContext('2d');
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            ctx = canvas.getContext('2d');
        }

        if (!ctx) return [];

        ctx.drawImage(bitmap, 0, 0, size, size);
        const imgData = ctx.getImageData(0, 0, size, size).data;

        // Define regions (Indices in 4x4 block grid, each block is 4px)
        // 16x16 px total.
        // We can just iterate pixels directly.
        // Regions:
        // TL: Blocks (0,0), (1,0), (0,1) -> rects: (0,0,8,4), (0,4,4,4)
        // Or simpler: Assign each pixel (x,y) to list of regions it belongs to.

        const regions: { pixels: Pixel[], anchor: Point }[] = [
            { pixels: [], anchor: { x: 0, y: 0 } },       // TL (Index 0)
            { pixels: [], anchor: { x: 15, y: 0 } },      // TR (Index 1)
            { pixels: [], anchor: { x: 0, y: 15 } },      // BL (Index 2)
            { pixels: [], anchor: { x: 15, y: 15 } },     // BR (Index 3)
            { pixels: [], anchor: { x: 7.5, y: 7.5 } }    // Center (Index 4)
        ];

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const p: Pixel = {
                    r: imgData[i],
                    g: imgData[i + 1],
                    b: imgData[i + 2],
                    x,
                    y,
                    weight: 0
                };

                const bx = Math.floor(x / 4); // Block X (0-3)
                const by = Math.floor(y / 4); // Block Y (0-3)

                // 1. Center: Inner 2x2 blocks ([1,1] to [2,2])
                if (bx >= 1 && bx <= 2 && by >= 1 && by <= 2) {
                    regions[4].pixels.push({ ...p });
                }

                // 2. Top-Left: (0,0), (1,0), (0,1)
                if ((bx === 0 && by === 0) || (bx === 1 && by === 0) || (bx === 0 && by === 1)) {
                    regions[0].pixels.push({ ...p });
                }

                // 3. Top-Right: (3,0), (2,0), (3,1)
                if ((bx === 3 && by === 0) || (bx === 2 && by === 0) || (bx === 3 && by === 1)) {
                    regions[1].pixels.push({ ...p });
                }

                // 4. Bottom-Left: (0,3), (1,3), (0,2)
                if ((bx === 0 && by === 3) || (bx === 1 && by === 3) || (bx === 0 && by === 2)) {
                    regions[2].pixels.push({ ...p });
                }

                // 5. Bottom-Right: (3,3), (2,3), (3,2)
                if ((bx === 3 && by === 3) || (bx === 2 && by === 3) || (bx === 3 && by === 2)) {
                    regions[3].pixels.push({ ...p });
                }
            }
        }

        const palette: number[] = regions.map(r => {
            if (r.pixels.length === 0) return 0; // Should not happen
            const c = extractRegionColor(r.pixels, r.anchor);
            return packColor(c);
        });

        return palette;
    } catch (e) {
        console.warn('Failed to extract cover palette:', e);
        return [];
    }
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
        console.error("File validation failed", e);
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
                        maxSizeMB: 0.05,
                        maxWidthOrHeight: 300,
                        useWebWorker: true,
                    });
                } catch (error) {
                    console.warn('Failed to compress cover image, using original:', error);
                    thumbnailBlob = coverBlob;
                }
            }
        } catch (error) {
            console.warn('Failed to retrieve cover blob:', error);
        }
    }

    // Generate palette if we have any cover image
    if (thumbnailBlob || coverBlob) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
            console.warn(`Metadata sanitized for "${candidateMetadata.title}":`, check.modifications);
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
