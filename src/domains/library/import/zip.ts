/**
 * ZIP expansion for batch import — cancellable, with read-progress
 * (Phase 7 PR-L1; moved from `lib/batch-ingestion.ts` and given an
 * `AbortSignal`: entries are decompressed in small chunks with an abort
 * check and a main-thread yield between chunks).
 */
// Type-only: the runtime module loads lazily inside extractEpubsFromZip —
// jszip (~96KB min) otherwise rides the eager LibraryView graph (via the
// ImportOrchestrator) into the entry chunk and is parsed on every boot.
import type JSZip from 'jszip';
import { CancellationError } from '@lib/cancellable-task-runner';
import { createLogger } from '@lib/logger';

const logger = createLogger('Ingestion');

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CancellationError('ZIP extraction cancelled');
}

/**
 * Unzips a file and extracts all EPUBs contained within.
 * Nested paths are flattened to basenames; non-EPUB entries are skipped.
 *
 * @param file - The ZIP file to process.
 * @param onProgress - Optional callback for reading progress (0-100).
 * @param signal - Aborts between entry chunks (throws CancellationError).
 * @returns A Promise resolving to an array of EPUB Files.
 */
export async function extractEpubsFromZip(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<File[]> {
  const { default: JSZipCtor } = await import('jszip');
  const zip = new JSZipCtor();
  const epubFiles: File[] = [];

  try {
    let zipContent: JSZip;

    throwIfAborted(signal);

    if (onProgress) {
      // Read the file with FileReader to report progress
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target?.result) {
            resolve(e.target.result as ArrayBuffer);
          } else {
            reject(new Error('Failed to read file'));
          }
        };
        reader.onerror = () => reject(reader.error);
        reader.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress((e.loaded / e.total) * 100);
          }
        };
        reader.readAsArrayBuffer(file);
      });
      zipContent = await zip.loadAsync(buffer);
    } else {
      zipContent = await zip.loadAsync(file);
    }

    const validEntries: JSZip.JSZipObject[] = [];

    zipContent.forEach((_, zipEntry) => {
      if (zipEntry.dir) return; // Skip directories
      if (!zipEntry.name.toLowerCase().endsWith('.epub')) return; // Skip non-epubs
      validEntries.push(zipEntry);
    });

    const CONCURRENCY_LIMIT = 5;
    for (let i = 0; i < validEntries.length; i += CONCURRENCY_LIMIT) {
      throwIfAborted(signal);
      const chunk = validEntries.slice(i, i + CONCURRENCY_LIMIT);

      const chunkPromises = chunk.map(async (zipEntry) => {
        const blob = await zipEntry.async('blob');
        // Reconstruct a File object. The full relative path is flattened to
        // the basename (collisions surface as duplicates downstream).
        const epubFile = new File([blob], zipEntry.name.split('/').pop() || zipEntry.name, {
          type: 'application/epub+zip',
        });
        epubFiles.push(epubFile);
      });

      await Promise.all(chunkPromises);

      // Yield to main thread to prevent UI freezing
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } catch (e) {
    if (e instanceof CancellationError) throw e;
    logger.error('Failed to process ZIP file:', e);
    throw new Error('Failed to process ZIP file. It might be corrupted or not a valid ZIP.');
  }

  throwIfAborted(signal);
  return epubFiles;
}
