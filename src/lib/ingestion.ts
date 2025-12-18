import ePub, { type NavigationItem } from 'epubjs';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../db/db';
import type { BookMetadata, SectionMetadata } from '../types/db';
import { getSanitizedBookMetadata } from '../db/validators';
import CryptoJS from 'crypto-js';

// Chunk size for hashing (e.g., 2MB)
const HASH_CHUNK_SIZE = 2 * 1024 * 1024;

/**
 * Computes the SHA-256 hash of a file incrementally using chunks.
 * This avoids loading the entire file into memory.
 *
 * @param file - The file to hash.
 * @returns The hex string representation of the hash.
 */
export async function computeFileHash(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    // CryptoJS.algo.SHA256.create() gives us an incremental hasher
    const algo = CryptoJS.algo.SHA256.create();
    let offset = 0;

    const readNextChunk = () => {
      if (offset >= file.size) {
        // Finalize hash
        const hash = algo.finalize();
        resolve(hash.toString(CryptoJS.enc.Hex));
        return;
      }

      const chunk = file.slice(offset, offset + HASH_CHUNK_SIZE);
      const reader = new FileReader();

      reader.onload = (e) => {
        if (e.target?.result) {
          const arrayBuffer = e.target.result as ArrayBuffer;
          // Convert ArrayBuffer to crypto-js WordArray
          const wordArray = CryptoJS.lib.WordArray.create(arrayBuffer);
          algo.update(wordArray);
          offset += HASH_CHUNK_SIZE;
          readNextChunk();
        } else {
          reject(new Error('Failed to read chunk'));
        }
      };

      reader.onerror = (e) => {
        reject(e.target?.error || new Error('FileReader error'));
      };

      reader.readAsArrayBuffer(chunk);
    };

    readNextChunk();
  });
}


// Helper to convert Blob to text using FileReader (for compatibility)
const blobToText = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(blob);
  });
};

/**
 * Validates that the file has a ZIP header (PK\x03\x04), which is required for EPUBs.
 * This prevents uploading random files or potential malware masked as EPUBs.
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
 * @returns A Promise that resolves to the UUID of the newly created book.
 * @throws Will throw an error if the file cannot be parsed or database operations fail.
 */
export async function processEpub(file: File): Promise<string> {
  // 1. Security Check: Validate File Header
  const isValid = await validateEpubFile(file);
  if (!isValid) {
      throw new Error("Invalid file format. File must be a valid EPUB (ZIP archive).");
  }

  // Pass File directly to ePub.js (it supports Blob/File/ArrayBuffer/Url)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = (ePub as any)(file);

  await book.ready;

  const metadata = await book.loaded.metadata;
  const bookId = uuidv4();

  // Generate Synthetic TOC and Calculate Durations
  const syntheticToc: NavigationItem[] = [];
  const sections: SectionMetadata[] = [];
  let totalChars = 0;

  try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spine = (book.spine as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = [];
      if (spine.each) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          spine.each((item: any) => items.push(item));
      } else if (spine.items) {
         items.push(...spine.items);
      }

      for (let i = 0; i < items.length; i++) {
           const item = items[i];
           let characterCount = 0;
           try {
               let title = '';
               // In ingestion context (file input), book.archive is available.
               // We use blob extraction + DOMParser as book.load() might rely on DOM attachment or network.
               if (book.archive) {
                    const blob = await book.archive.getBlob(item.href);
                    if (blob) {
                        const text = await blobToText(blob);
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(text, "application/xhtml+xml");

                        const headings = doc.querySelectorAll('h1, h2, h3');
                        if (headings.length > 0) {
                            title = headings[0].textContent || '';
                        }

                        if (!title.trim()) {
                            const p = doc.querySelector('p');
                            if (p && p.textContent) title = p.textContent;
                        }

                        if (!title.trim()) {
                            title = doc.body.textContent || '';
                        }

                        // Calculate character count from text content
                        const contentText = doc.body.textContent || '';
                        characterCount = contentText.length;
                        totalChars += characterCount;


                        // Clean up
                        title = title.replace(/\s+/g, ' ').trim();
                        if (title.length > 60) {
                           title = title.substring(0, 60) + '...';
                        }
                    }
               }

               if (!title) title = `Chapter ${i+1}`;

               syntheticToc.push({
                   id: item.id || `syn-toc-${i}`,
                   href: item.href,
                   label: title
               });

               // Store section metadata
               sections.push({
                 id: `${bookId}-${item.href}`, // Composite key
                 bookId: bookId,
                 sectionId: item.href, // This corresponds to currentSectionId
                 characterCount: characterCount,
                 playOrder: i
               });

           } catch (e) {
                console.error("Error generating TOC item or calculating duration", e);
                syntheticToc.push({ id: item.id || `syn-toc-${i}`, href: item.href, label: `Chapter ${i+1}` });
           }
      }
  } catch (e) {
      console.error("Error generating synthetic TOC", e);
  }

  let coverBlob: Blob | undefined;
  const coverUrl = await book.coverUrl();

  if (coverUrl) {
    try {
      const response = await fetch(coverUrl);
      coverBlob = await response.blob();
    } catch (error) {
      console.warn('Failed to retrieve cover blob:', error);
    }
  }

  // Calculate SHA-256 hash incrementally
  const fileHash = await computeFileHash(file);

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

  const tx = db.transaction(['books', 'files', 'sections'], 'readwrite');
  await tx.objectStore('books').add(finalBook);
  await tx.objectStore('files').add(file, bookId);

  // Store section metadata
  const sectionsStore = tx.objectStore('sections');
  for (const section of sections) {
    await sectionsStore.add(section);
  }

  await tx.done;

  return bookId;
}
