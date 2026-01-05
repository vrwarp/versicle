import { getDB } from '../db/db';
import type { Checkpoint } from '../types/db';

export class CheckpointService {
  private MAX_CHECKPOINTS = 10;

  async createCheckpoint(reason: string): Promise<number> {
    const db = await getDB();
    const books = await db.getAll('books');
    const history = await db.getAll('reading_history');
    const annotations = await db.getAll('annotations');
    const lexicon = await db.getAll('lexicon');

    const timestamp = Date.now();

    // Only store "Moral Layer" data
    const data = {
        books: books.map(b => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { coverBlob, ...rest } = b;
            return rest;
        }),
        history,
        annotations,
        lexicon
    };

    const serialized = JSON.stringify(data);
    const checkpoint: Checkpoint = {
        timestamp,
        data: serialized,
        reason,
        size: serialized.length
    };

    await db.put('checkpoints', checkpoint);
    await this.pruneCheckpoints();

    return timestamp;
  }

  async restoreCheckpoint(timestamp: number): Promise<void> {
    const db = await getDB();
    const checkpoint = await db.get('checkpoints', timestamp);

    if (!checkpoint) {
        throw new Error(`Checkpoint ${timestamp} not found`);
    }

    const data = JSON.parse(checkpoint.data);

    const tx = db.transaction(['books', 'reading_history', 'annotations', 'lexicon'], 'readwrite');

    // Restore Books Metadata (careful not to delete existing file blobs if they exist?)
    // The requirement says "clears the current metadata stores and repopulates them".
    // But we must preserve the 'files' store which is separate.
    // 'books' store contains coverBlob. The checkpoint excludes it.
    // If we clear 'books', we lose coverBlobs for existing books.
    // We should probably merge: Update metadata for existing books, add missing books (without covers?), remove extra books?
    // "Restoration: Upon selecting a checkpoint, the app clears the current metadata stores and repopulates them from the snapshot."
    // This implies we might lose coverBlobs if they are in 'books'.
    // Looking at DB schema: 'books' has 'coverBlob'.
    // Checkpoint excludes it.
    // So restoration will result in books without covers.
    // That seems to be an acceptable trade-off for "Moral Layer" restoration, or we need to be smarter.
    // Let's assume we clear and restore. The coverBlob might be lost, or we can try to preserve it if the book ID matches.

    // Let's try to preserve coverBlobs if possible.
    const currentBooks = await tx.objectStore('books').getAll();
    const coverMap = new Map<string, Blob>();
    for (const b of currentBooks) {
        if (b.coverBlob) {
            coverMap.set(b.id, b.coverBlob);
        }
    }

    await tx.objectStore('books').clear();
    for (const book of data.books) {
        if (coverMap.has(book.id)) {
            book.coverBlob = coverMap.get(book.id);
        }
        await tx.objectStore('books').put(book);
    }

    await tx.objectStore('reading_history').clear();
    for (const h of data.history) {
        await tx.objectStore('reading_history').put(h);
    }

    await tx.objectStore('annotations').clear();
    for (const a of data.annotations) {
        await tx.objectStore('annotations').put(a);
    }

    await tx.objectStore('lexicon').clear();
    for (const l of data.lexicon) {
        await tx.objectStore('lexicon').put(l);
    }

    await tx.done;
  }

  async getCheckpoints(): Promise<Checkpoint[]> {
    const db = await getDB();
    return await db.getAll('checkpoints');
  }

  private async pruneCheckpoints() {
      const db = await getDB();
      const keys = await db.getAllKeys('checkpoints');
      if (keys.length > this.MAX_CHECKPOINTS) {
          const sortedKeys = keys.sort((a, b) => (a as number) - (b as number));
          const toDelete = sortedKeys.slice(0, keys.length - this.MAX_CHECKPOINTS);
          for (const key of toDelete) {
              await db.delete('checkpoints', key);
          }
      }
  }
}
