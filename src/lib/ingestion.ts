import ePub, { type NavigationItem } from 'epubjs';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../db/db';
import type { BookMetadata } from '../types/db';
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
 * Processes an EPUB file, extracting metadata and cover image, and storing it in the database.
 *
 * @param file - The EPUB file object to process.
 * @returns A Promise that resolves to the UUID of the newly created book.
 * @throws Will throw an error if the file cannot be parsed or database operations fail.
 */
export async function processEpub(file: File): Promise<string> {
  // Pass File directly to ePub.js (it supports Blob/File/ArrayBuffer/Url)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = (ePub as any)(file);

  await book.ready;

  const metadata = await book.loaded.metadata;

  // Generate Synthetic TOC
  const syntheticToc: NavigationItem[] = [];
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
           } catch (e) {
                console.error("Error generating TOC item", e);
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

  const bookId = uuidv4();

  const newBook: BookMetadata = {
    id: bookId,
    title: metadata.title || 'Untitled',
    author: metadata.creator || 'Unknown Author',
    description: metadata.description || '',
    addedAt: Date.now(),
    coverBlob: coverBlob,
    fileHash,
    isOffloaded: false,
    fileSize: file.size,
    syntheticToc,
  };

  const db = await getDB();

  const tx = db.transaction(['books', 'files'], 'readwrite');
  await tx.objectStore('books').add(newBook);

  // Store the File (Blob) directly instead of ArrayBuffer
  await tx.objectStore('files').add(file, bookId);
  await tx.done;

  return bookId;
}
