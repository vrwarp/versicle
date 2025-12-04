import ePub from 'epubjs';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../db/db';
import type { BookMetadata } from '../types/db';

/**
 * Processes an EPUB file, extracting metadata and cover image, and storing it in the database.
 *
 * @param file - The EPUB file object to process.
 * @returns A Promise that resolves to the UUID of the newly created book.
 * @throws Will throw an error if the file cannot be parsed or database operations fail.
 */
export async function processEpub(file: File): Promise<string> {
  // Calculate SHA-256 hash using arrayBuffer for hashing only
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const fileHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  // Free up arrayBuffer reference if possible (JS garbage collection will handle it)
  // We don't need arrayBuffer for ePub(file) as we pass the File object directly.

  // Pass file directly to epub.js (supports Blob/File)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = (ePub as any)(file);

  await book.ready;

  const metadata = await book.loaded.metadata;

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
  };

  const db = await getDB();

  const tx = db.transaction(['books', 'files'], 'readwrite');
  await tx.objectStore('books').add(newBook);
  // Store the File object (Blob) directly instead of ArrayBuffer
  await tx.objectStore('files').add(file, bookId);
  await tx.done;

  return bookId;
}
