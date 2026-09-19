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
 * Read the whole archive once, reporting read progress as it goes, and
 * always finishing at 100 so a caller's byte-weighted bar reaches this
 * file's share even when the platform emits no `progress` events.
 *
 * This costs no extra memory over handing the File to `loadAsync`: jszip's
 * `prepareContent` runs exactly this FileReader itself for a Blob/File, and
 * then does `new Uint8Array(arrayBuffer)` (`transform.arraybuffer.uint8array`
 * in `jszip/lib/utils.js`) — a VIEW over the same buffer, not a copy. The
 * `Uint8ArrayReader` it hands to `zipEntries.load` keeps that same view and
 * serves entries with `subarray`. So the archive is resident exactly once
 * either way; passing the buffer only moves the read to where we can watch it.
 */
function readArchiveWithProgress(file: File, onProgress: (percent: number) => void): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        onProgress(100);
        resolve(e.target.result as ArrayBuffer);
      } else {
        reject(new Error('Failed to read file'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.min(100, (e.loaded / e.total) * 100));
      }
    };
    reader.readAsArrayBuffer(file);
  });
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
 * Enumeration still has to read the whole archive (jszip parses the central
 * directory out of the bytes), which for a multi-GB batch is seconds of
 * nothing to look at. With `onProgress` the read goes through a FileReader
 * so that wait is visible; see {@link readArchiveWithProgress} for why that
 * does not cost a second copy. Without one, the File goes straight to
 * `loadAsync`, which reads it the same way internally.
 *
 * @param file - The ZIP file to enumerate.
 * @param onProgress - Optional READ progress (0-100); always ends at 100.
 * @param signal - Aborts before the read and inside each `read()`.
 */
export async function listZipEpubEntries(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<ZipEpubEntry[]> {
  const { default: JSZipCtor } = await import('jszip');
  const zip = new JSZipCtor();

  try {
    throwIfAborted(signal);

    const source = onProgress ? await readArchiveWithProgress(file, onProgress) : file;
    const zipContent = await zip.loadAsync(source);
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
  const entries = await listZipEpubEntries(file, undefined, signal);
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
