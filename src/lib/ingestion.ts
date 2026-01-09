import ePub, { type NavigationItem } from 'epubjs';
import { v4 as uuidv4 } from 'uuid';
import imageCompression from 'browser-image-compression';
import { getDB } from '../db/db';
import type { SectionMetadata, TTSContent, TableImage, StaticBookManifest, StaticResource, UserInventoryItem, UserProgress, UserOverrides } from '../types/db';
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
  // Table images not supported in v18 persistence yet, skipping.
  let totalChars = 0;

  chapters.forEach((chapter, i) => {
      syntheticToc.push({
          id: `syn-toc-${i}`,
          href: chapter.href,
          label: chapter.title || `Chapter ${i+1}`
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
  });

  const tx = db.transaction(['static_manifests', 'static_structure', 'cache_tts_preparation'], 'readwrite');

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

  await tx.done;
}

export async function processEpub(
  file: File,
  ttsOptions?: ExtractionOptions,
  onProgress?: (progress: number, message: string) => void
): Promise<string> {
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

  book.destroy();

  const chapters = await extractContentOffscreen(file, ttsOptions, onProgress);

  const bookId = uuidv4();
  const syntheticToc: NavigationItem[] = [];
  const sections: SectionMetadata[] = [];
  const ttsContentBatches: TTSContent[] = [];
  let totalChars = 0;

  chapters.forEach((chapter, i) => {
      syntheticToc.push({
          id: `syn-toc-${i}`,
          href: chapter.href,
          label: chapter.title || `Chapter ${i+1}`
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
  });

  const fileHash = await generateFileFingerprint(file, {
    title: metadata.title || 'Untitled',
    author: metadata.creator || 'Unknown Author',
    filename: file.name
  });

  // Construct New Data Objects
  const manifest: StaticBookManifest = {
      bookId,
      title: metadata.title || 'Untitled',
      author: metadata.creator || 'Unknown Author',
      description: metadata.description || '',
      fileHash,
      fileSize: file.size,
      totalChars,
      schemaVersion: CURRENT_BOOK_VERSION,
      isbn: undefined,
      coverBlob: thumbnailBlob || coverBlob // Store thumbnail in manifest
  };

  const resource: StaticResource = {
      bookId,
      epubBlob: file,
      coverBlob: thumbnailBlob || coverBlob // Also store in resources (could be higher res if we separated them)
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
      addedAt: Date.now(),
      sourceFilename: file.name,
      tags: [],
      status: 'unread',
      lastInteraction: Date.now()
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

  const db = await getDB();
  const tx = db.transaction([
      'static_manifests', 'static_resources', 'static_structure',
      'user_inventory', 'user_progress', 'user_overrides',
      'cache_tts_preparation'
  ], 'readwrite');

  await tx.objectStore('static_manifests').add(manifest);
  await tx.objectStore('static_resources').add(resource);
  await tx.objectStore('static_structure').add(structure);
  await tx.objectStore('user_inventory').add(inventory);
  await tx.objectStore('user_progress').add(progress);
  await tx.objectStore('user_overrides').add(overrides);

  const ttsStore = tx.objectStore('cache_tts_preparation');
  for (const batch of ttsContentBatches) {
      await ttsStore.add({
          id: batch.id,
          bookId: batch.bookId,
          sectionId: batch.sectionId,
          sentences: batch.sentences
      });
  }

  await tx.done;

  return bookId;
}
