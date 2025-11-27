import ePub from 'epubjs';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../db/db';
import type { BookMetadata } from '../types/db';

export async function processEpub(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = (ePub as any)(arrayBuffer);

  await book.ready;

  const metadata = await book.loaded.metadata;

  let coverBlob: Blob | undefined;
  const coverUrl = await book.coverUrl();

  if (coverUrl) {
    try {
      coverBlob = await book.archive.getBlob(coverUrl);
    } catch (error) {
      console.warn('Failed to retrieve cover blob:', error);
    }
  }

  const bookId = uuidv4();

  const newBook: BookMetadata = {
    id: bookId,
    title: metadata.title,
    author: metadata.creator,
    description: metadata.description,
    addedAt: Date.now(),
    coverBlob: coverBlob,
  };

  const db = await getDB();

  const tx = db.transaction(['books', 'files'], 'readwrite');
  await tx.objectStore('books').add(newBook);
  await tx.objectStore('files').add(arrayBuffer, bookId);
  await tx.done;

  return bookId;
}
