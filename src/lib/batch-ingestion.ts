
import JSZip from 'jszip';
import { processEpub } from './ingestion';
import type { ExtractionOptions } from './tts';

/**
 * Unzips a file and extracts all EPUBs contained within.
 * It recursively checks for EPUBs but currently only extracts from the root or flattened structure of the zip.
 *
 * @param file - The ZIP file to process.
 * @returns A Promise resolving to an array of EPUB Files.
 */
export async function extractEpubsFromZip(file: File): Promise<File[]> {
    const zip = new JSZip();
    const epubFiles: File[] = [];

    try {
        const zipContent = await zip.loadAsync(file);

        const processingPromises: Promise<void>[] = [];

        zipContent.forEach((_, zipEntry) => {
            if (zipEntry.dir) return; // Skip directories
            if (!zipEntry.name.toLowerCase().endsWith('.epub')) return; // Skip non-epubs

            const promise = async () => {
                const blob = await zipEntry.async('blob');
                // Reconstruct a File object
                // We use the full relative path as the name to avoid collisions,
                // but we might want to strip paths depending on requirements.
                // For now, using the name from the zip entry.
                const epubFile = new File([blob], zipEntry.name.split('/').pop() || zipEntry.name, {
                    type: 'application/epub+zip'
                });
                epubFiles.push(epubFile);
            };
            processingPromises.push(promise());
        });

        await Promise.all(processingPromises);

    } catch (e) {
        console.error("Failed to process ZIP file:", e);
        throw new Error("Failed to process ZIP file. It might be corrupted or not a valid ZIP.");
    }

    return epubFiles;
}

/**
 * Batch processes multiple files (EPUBs or ZIPs containing EPUBs).
 *
 * @param files - Array of files to process.
 * @param ttsOptions - TTS options for processing.
 * @param onProgress - Callback for overall progress.
 */
export async function processBatchImport(
    files: File[],
    ttsOptions?: ExtractionOptions,
    onProgress?: (processed: number, total: number, filename: string) => void
): Promise<number> {
    let allEpubs: File[] = [];

    // Pre-processing: Expand ZIPs
    for (const file of files) {
        if (file.name.toLowerCase().endsWith('.zip')) {
            try {
                const extracted = await extractEpubsFromZip(file);
                allEpubs = [...allEpubs, ...extracted];
            } catch (e) {
                console.warn(`Failed to extract zip ${file.name}:`, e);
                // Continue with other files
            }
        } else if (file.name.toLowerCase().endsWith('.epub')) {
            allEpubs.push(file);
        }
    }

    let successCount = 0;
    const total = allEpubs.length;

    // Process each EPUB
    for (let i = 0; i < total; i++) {
        const epub = allEpubs[i];
        if (onProgress) {
            onProgress(i, total, epub.name);
        }

        try {
            await processEpub(epub, ttsOptions);
            successCount++;
        } catch (e) {
            console.error(`Failed to import ${epub.name}:`, e);
        }
    }

    return successCount;
}
