
import { bookImportService } from './BookImportService';
import type { ExtractionOptions } from './ingestion/sentence-extraction';
import type { StaticBookManifest } from '~types/db';

// ZIP expansion moved to the unified import pipeline (Phase 7 PR-L1) and
// gained cancellation; re-exported here for this module's consumers until
// PR-L2 absorbs the batch path into the ImportOrchestrator.
export { extractEpubsFromZip } from '@domains/library/import/zip';
import { extractEpubsFromZip } from '@domains/library/import/zip';

/** A file that could not be imported, with the reason for the failure. */
export interface BatchImportFailure {
    filename: string;
    reason: string;
}

/** Per-file outcome summary of a batch import. */
export interface BatchImportResult {
    successful: { manifest: StaticBookManifest; sourceFilename: string }[];
    /** Filenames skipped because a book with the same source filename already exists. */
    skipped: string[];
    failed: BatchImportFailure[];
}

/** Pre-import checks injected by the caller (this module must not import stores). */
export interface BatchImportChecks {
    /** Returns true when a book with this source filename already exists in the library. */
    isDuplicate?: (filename: string) => boolean | Promise<boolean>;
}

/**
 * Batch processes multiple files (EPUBs or ZIPs containing EPUBs).
 *
 * Every input file is accounted for in the result: imported, skipped as a
 * duplicate (via the injected `checks.isDuplicate`, mirroring the single-import
 * path's filename-based duplicate detection), or failed with a reason.
 *
 * @param files - Array of files to process.
 * @param ttsOptions - TTS options for processing.
 * @param onProgress - Callback for overall import progress.
 * @param onUploadProgress - Callback for upload/extraction progress.
 * @param checks - Optional duplicate detection injected by the caller.
 */
export async function processBatchImport(
    files: File[],
    ttsOptions?: ExtractionOptions,
    onProgress?: (processed: number, total: number, filename: string) => void,
    onUploadProgress?: (percent: number, status: string) => void,
    checks?: BatchImportChecks
): Promise<BatchImportResult> {
    let allEpubs: File[] = [];
    const failed: BatchImportFailure[] = [];

    // Calculate total size for upload/extraction progress
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    let processedBytes = 0;

    const updateUploadProgress = (bytes: number, filename: string) => {
        if (onUploadProgress) {
            const percentage = totalSize > 0 ? Math.min(100, Math.round((bytes / totalSize) * 100)) : 100;
            onUploadProgress(percentage, `Processing ${filename}...`);
        }
    };

    // Pre-processing: Expand ZIPs
    for (const file of files) {
        const startBytes = processedBytes;
        if (file.name.toLowerCase().endsWith('.zip')) {
            try {
                const extracted = await extractEpubsFromZip(file, (percent) => {
                    const fileBytesDone = (percent / 100) * file.size;
                    updateUploadProgress(startBytes + fileBytesDone, file.name);
                });
                allEpubs = [...allEpubs, ...extracted];
            } catch (e) {
                console.warn(`Failed to extract zip ${file.name}:`, e);
                failed.push({
                    filename: file.name,
                    reason: e instanceof Error ? e.message : 'Failed to extract ZIP archive.'
                });
                // Continue with other files
            }
        } else if (file.name.toLowerCase().endsWith('.epub')) {
            allEpubs.push(file);
        } else {
            failed.push({
                filename: file.name,
                reason: 'Unsupported file type (expected .epub or .zip).'
            });
        }

        // Mark this file as fully processed
        processedBytes += file.size;
        updateUploadProgress(processedBytes, file.name);
    }

    // Ensure 100% upload progress when done
    if (onUploadProgress) {
        onUploadProgress(100, 'All files processed. Starting import...');
    }

    const successful: { manifest: StaticBookManifest; sourceFilename: string }[] = [];
    const skipped: string[] = [];
    const importedFilenames = new Set<string>();
    const total = allEpubs.length;

    // Process each EPUB
    for (let i = 0; i < total; i++) {
        const epub = allEpubs[i];
        if (onProgress) {
            onProgress(i, total, epub.name);
        }

        try {
            // Honor the same filename-based duplicate detection as the single-import
            // path (injected by the caller), plus repeats within this batch.
            const isDuplicate = importedFilenames.has(epub.name)
                || (checks?.isDuplicate ? await checks.isDuplicate(epub.name) : false);
            if (isDuplicate) {
                skipped.push(epub.name);
                continue;
            }

            const manifest = await bookImportService.addBook(epub, ttsOptions);
            if (manifest) {
                successful.push({
                    manifest,
                    sourceFilename: epub.name
                });
                importedFilenames.add(epub.name);
            } else {
                failed.push({
                    filename: epub.name,
                    reason: 'Import did not produce a book manifest.'
                });
            }
        } catch (e) {
            console.error(`Failed to import ${epub.name}:`, e);
            failed.push({
                filename: epub.name,
                reason: e instanceof Error ? e.message : String(e)
            });
        }
    }

    return { successful, skipped, failed };
}
