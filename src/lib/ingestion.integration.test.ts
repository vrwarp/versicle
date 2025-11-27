import { describe, it, expect, beforeEach } from 'vitest';
import { processEpub } from './ingestion';
import { getDB } from '../db/db';
import * as fs from 'fs';
import * as path from 'path';

// We do NOT mock epubjs here because we want to test the real integration with a real file.
// However, we still need to make sure the environment (JSDOM) supports what epubjs needs.
// epubjs uses XMLSerializer, DOMParser, and potentially FileReader/Blob. JSDOM provides these.

describe('ingestion integration', () => {
  beforeEach(async () => {
    // Clear DB
    const db = await getDB();
    const tx = db.transaction(['books', 'files', 'annotations'], 'readwrite');
    await tx.objectStore('books').clear();
    await tx.objectStore('files').clear();
    await tx.done;
  });

  it('should process a real epub file (Alice in Wonderland)', async () => {
    // Read the fixture file
    const fixturePath = path.resolve(__dirname, '../test/fixtures/alice.epub');
    const buffer = fs.readFileSync(fixturePath);

    // Create a File object (JSDOM environment has File)
    // JSDOM 27 (used here) might not implement File.prototype.arrayBuffer().
    // We can polyfill it or just assign it.
    const file = new File([buffer], 'alice.epub', { type: 'application/epub+zip' });

    // Use FileReader to implement arrayBuffer since Response doesn't seem to work with Blob in JSDOM 27
    if (!file.arrayBuffer) {
         file.arrayBuffer = () => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    // Process the epub
    const bookId = await processEpub(file);

    expect(bookId).toBeDefined();

    // Verify DB contents
    const db = await getDB();
    const book = await db.get('books', bookId);

    expect(book).toBeDefined();
    // The title in the epub metadata is "Alice's Adventures in Wonderland"
    expect(book?.title).toContain("Alice's Adventures in Wonderland");
    // Author might be 'Lewis Carroll' or 'Carroll, Lewis' depending on metadata in the file
    expect(book?.author).toContain('Lewis Carroll');

    const storedFile = await db.get('files', bookId);
    expect(storedFile).toBeDefined();
    // Compare stored buffer with original
    // storedFile is an ArrayBuffer, buffer is a Buffer (Uint8Array)
    expect(new Uint8Array(storedFile as ArrayBuffer)).toEqual(new Uint8Array(buffer));
  });
});
