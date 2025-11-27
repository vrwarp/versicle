import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BookMetadata, Annotation } from '../types/db';

export interface EpubLibraryDB extends DBSchema {
  books: {
    key: string;
    value: BookMetadata;
    indexes: {
      by_title: string;
      by_author: string;
      by_addedAt: number;
    };
  };
  files: {
    key: string;
    value: ArrayBuffer;
  };
  annotations: {
    key: string;
    value: Annotation;
    indexes: {
      by_bookId: string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<EpubLibraryDB>>;

export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<EpubLibraryDB>('EpubLibraryDB', 1, {
      upgrade(db) {
        // Books store
        if (!db.objectStoreNames.contains('books')) {
          const booksStore = db.createObjectStore('books', { keyPath: 'id' });
          booksStore.createIndex('by_title', 'title', { unique: false });
          booksStore.createIndex('by_author', 'author', { unique: false });
          booksStore.createIndex('by_addedAt', 'addedAt', { unique: false });
        }

        // Files store
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files');
        }

        // Annotations store
        if (!db.objectStoreNames.contains('annotations')) {
          const annotationsStore = db.createObjectStore('annotations', { keyPath: 'id' });
          annotationsStore.createIndex('by_bookId', 'bookId', { unique: false });
        }
      },
    });
  }
  return dbPromise;
};

export const getDB = () => {
  if (!dbPromise) {
    return initDB();
  }
  return dbPromise;
};
