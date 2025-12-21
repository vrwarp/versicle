import ePub, { type NavigationItem } from 'epubjs';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../db/db';
import type { BookMetadata, SectionMetadata, TTSContent } from '../types/db';
import { getSanitizedBookMetadata } from '../db/validators';
import type { ExtractionOptions } from './tts';
import { extractContentOffscreen } from './offscreen-renderer';

function cheapHash(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let hash = 5381;
  for (let i = 0; i < view.length; i++) {
    hash = ((hash << 5) + hash) + view[i]; /* hash * 33 + c */
  }
  return (hash >>> 0).toString(16);
}

/**
 * Generates a unique fingerprint for a file based on metadata and content sampling.
 * This is much faster than a full cryptographic hash (SHA-256).
 *
 * @param file - The file (or blob) to fingerprint.
 * @param metadata - The metadata to include in the fingerprint (title, author, filename).
 * @returns A string fingerprint.
 */
export async function generateFileFingerprint(
  file: Blob,
  metadata: { title: string; author: string; filename: string }
): Promise<string> {
  // 1. Metadata: This acts as the primary filter.
  // We use title/author/filename instead of volatile attributes like size/lastModified.
  const metaString = `${metadata.filename}-${metadata.title}-${metadata.author}`;

  // 2. Head/Tail Sampling: Read the first 4KB and last 4KB of the file.
  // The header usually contains file format signatures (magic bytes) and metadata.
  // The footer often contains EOF markers or central directory records (in ZIP/EPUB).
  const headSize = Math.min(4096, file.size);

  const head = await file.slice(0, headSize).arrayBuffer();
  // if file is smaller than 4096, tail overlaps head, which is fine for fingerprinting
  const tail = await file.slice(Math.max(0, file.size - 4096), file.size).arrayBuffer();

  // 3. Fast non-crypto hash
  return `${metaString}-${cheapHash(head)}-${cheapHash(tail)}`;
}

/**
 * Validates that the file has a ZIP header (PK\x03\x04), which is required for EPUBs.
 * This prevents uploading random files or potential malware masked as EPUBs.
 * It checks the first 4 bytes for the Magic Number: 50 4B 03 04.
 *
 * @param file - The file to validate.
 * @returns A Promise resolving to true if valid, false otherwise.
 */
export async function validateEpubFile(file: File): Promise<boolean> {
    try {
        const buffer = await file.slice(0, 4).arrayBuffer();
        const view = new DataView(buffer);
        // PK\x03\x04 => 0x50 0x4B 0x03 0x04
        return view.getUint8(0) === 0x50 &&
               view.getUint8(1) === 0x4B &&
               view.getUint8(2) === 0x03 &&
               view.getUint8(3) === 0x04;
    } catch (e) {
        console.error("File validation failed", e);
        return false;
    }
}

/**
 * Processes an EPUB file, extracting metadata and cover image, and storing it in the database.
 *
 * @param file - The EPUB file object to process.
 * @param ttsOptions - Configuration options for TTS sentence extraction.
 * @param onProgress - Callback for progress updates.
 * @returns A Promise that resolves to the UUID of the newly created book.
 * @throws Will throw an error if the file cannot be parsed or database operations fail.
 */
export async function processEpub(
  file: File,
  ttsOptions?: ExtractionOptions,
  onProgress?: (progress: number, message: string) => void
): Promise<string> {
  // 1. Security Check: Validate File Header
  const isValid = await validateEpubFile(file);
  if (!isValid) {
      throw new Error("Invalid file format. File must be a valid EPUB (ZIP archive).");
  }

  // 2. Metadata & Cover (Fast pass)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = (ePub as any)(file);
  await book.ready;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metadata = await (book.loaded as any).metadata;
  const coverUrl = await book.coverUrl();

  let coverBlob: Blob | undefined;
  if (coverUrl) {
    try {
      const response = await fetch(coverUrl);
      coverBlob = await response.blob();
    } catch (error) {
      console.warn('Failed to retrieve cover blob:', error);
    }
  }

  // Destroy this instance as we will use a new one for offscreen rendering
  book.destroy();

  // 3. Offscreen Extraction (Slow pass)
  const chapters = await extractContentOffscreen(file, ttsOptions, onProgress);

  const bookId = uuidv4();
  const syntheticToc: NavigationItem[] = [];
  const sections: SectionMetadata[] = [];
  const ttsContentBatches: TTSContent[] = [];
  let totalChars = 0;

  chapters.forEach((chapter, i) => {
      // Synthetic TOC
      syntheticToc.push({
          id: `syn-toc-${i}`,
          href: chapter.href,
          label: chapter.title || `Chapter ${i+1}`
      });

      // Section Metadata
      sections.push({
          id: `${bookId}-${chapter.href}`,
          bookId,
          sectionId: chapter.href,
          characterCount: chapter.textContent.length,
          playOrder: i
      });
      totalChars += chapter.textContent.length;

      // TTS Content
      if (chapter.sentences.length > 0) {
          ttsContentBatches.push({
              id: `${bookId}-${chapter.href}`,
              bookId,
              sectionId: chapter.href,
              sentences: chapter.sentences
          });
      }
  });

  // Calculate fingerprint
  const fileHash = await generateFileFingerprint(file, {
    title: metadata.title || 'Untitled',
    author: metadata.creator || 'Unknown Author',
    filename: file.name
  });

  const candidateBook: BookMetadata = {
    id: bookId,
    filename: file.name,
    title: metadata.title || 'Untitled',
    author: metadata.creator || 'Unknown Author',
    description: metadata.description || '',
    addedAt: Date.now(),
    coverBlob: coverBlob,
    fileHash,
    isOffloaded: false,
    fileSize: file.size,
    syntheticToc,
    totalChars, // Store the calculated total characters
  };

  const check = getSanitizedBookMetadata(candidateBook);
  let finalBook = candidateBook;

  if (check) {
    // Always sanitize metadata to ensure security (XSS prevention) and DB integrity
    finalBook = check.sanitized;
    if (check.wasModified) {
       console.warn(`Metadata sanitized for "${candidateBook.title}":`, check.modifications);
    }
  }

  const db = await getDB();

  const tx = db.transaction(['books', 'files', 'sections', 'tts_content'], 'readwrite');
  await tx.objectStore('books').add(finalBook);
  await tx.objectStore('files').add(file, bookId);

  // Store section metadata
  const sectionsStore = tx.objectStore('sections');
  for (const section of sections) {
    await sectionsStore.add(section);
  }

  // Store TTS content
  const ttsStore = tx.objectStore('tts_content');
  for (const batch of ttsContentBatches) {
      await ttsStore.add(batch);
  }

  await tx.done;

  return bookId;
}
