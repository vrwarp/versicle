/**
 * ZIP expansion for batch import — cancellable, with read-progress
 * (Phase 7 PR-L1; moved from `lib/batch-ingestion.ts` and given an
 * `AbortSignal`: entries are decompressed one at a time with an abort check
 * and a main-thread yield between them).
 */
// The jszip runtime module loads lazily inside the exported helpers —
// jszip (~96KB min) otherwise rides the eager LibraryView graph (via the
// ImportOrchestrator) into the entry chunk and is parsed on every boot.
import { CancellationError } from '@lib/cancellable-task-runner';
import { createLogger } from '@lib/logger';

const logger = createLogger('Ingestion');

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CancellationError('ZIP extraction cancelled');
}

/**
 * One EPUB inside a ZIP, NOT yet decompressed. `read()` inflates it on
 * demand so a batch importer can consume books one at a time instead of
 * holding every extracted EPUB of the archive in memory at once.
 */
export interface ZipEpubEntry {
  /** The entry's basename (nested paths are flattened, as before). */
  name: string;
  /** Inflate this entry into a File. Intended to be called once. */
  read(): Promise<File>;
}

/**
 * Enumerate the EPUB entries of a ZIP without decompressing any of them.
 *
 * The File is handed straight to `loadAsync`: reading it into an ArrayBuffer
 * first (the old FileReader progress path) put a second full copy of the
 * archive in memory on top of jszip's own view of it.
 */
export async function listZipEpubEntries(
  file: File,
  signal?: AbortSignal,
): Promise<ZipEpubEntry[]> {
  const { default: JSZipCtor } = await import('jszip');
  const zip = new JSZipCtor();

  try {
    throwIfAborted(signal);

    const zipContent = await zip.loadAsync(file);
    const entries: ZipEpubEntry[] = [];

    zipContent.forEach((_, zipEntry) => {
      if (zipEntry.dir) return; // Skip directories
      if (!zipEntry.name.toLowerCase().endsWith('.epub')) return; // Skip non-epubs

      // The full relative path is flattened to the basename (collisions
      // surface as duplicates downstream).
      const name = zipEntry.name.split('/').pop() || zipEntry.name;
      entries.push({
        name,
        read: async () => {
          throwIfAborted(signal);
          const blob = await zipEntry.async('blob');
          return new File([blob], name, { type: 'application/epub+zip' });
        },
      });
    });

    return entries;
  } catch (e) {
    if (e instanceof CancellationError) throw e;
    logger.error('Failed to process ZIP file:', e);
    throw new Error('Failed to process ZIP file. It might be corrupted or not a valid ZIP.');
  }
}

/**
 * Unzips a file and extracts all EPUBs contained within.
 * Nested paths are flattened to basenames; non-EPUB entries are skipped.
 *
 * Eager convenience wrapper over {@link listZipEpubEntries} — it materializes
 * every EPUB. Importers should consume the entries one at a time instead.
 *
 * @param file - The ZIP file to process.
 * @param onProgress - Optional callback for extraction progress (0-100).
 * @param signal - Aborts between entries (throws CancellationError).
 * @returns A Promise resolving to an array of EPUB Files.
 */
export async function extractEpubsFromZip(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<File[]> {
  const entries = await listZipEpubEntries(file, signal);
  const epubFiles: File[] = [];

  try {
    for (let i = 0; i < entries.length; i++) {
      throwIfAborted(signal);
      epubFiles.push(await entries[i].read());
      onProgress?.(((i + 1) / entries.length) * 100);

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
