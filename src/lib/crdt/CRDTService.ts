import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { CRDT_KEYS } from './types';
import type { Annotation, LexiconRule, ReadingListEntry, TTSPosition } from '../../types/db';

export class CRDTService {
  public doc: Y.Doc;
  private provider: IndexeddbPersistence;
  private _isReady: boolean = false;

  constructor(persistenceName: string = 'versicle-moral-doc') {
    this.doc = new Y.Doc();
    // Initialize persistence
    // y-indexeddb persists the document updates to IndexedDB.
    this.provider = new IndexeddbPersistence(persistenceName, this.doc);

    this.provider.on('synced', () => {
      this._isReady = true;
      console.log(`[CRDT] Loaded from ${persistenceName}`);
    });
  }

  get isReady() {
    return this._isReady;
  }

  async waitForReady(): Promise<void> {
    if (this._isReady) return;
    return new Promise(resolve => {
      this.provider.once('synced', () => resolve());
    });
  }

  // Typed getters for the shared structures
  get books() {
    return this.doc.getMap<Y.Map<any>>(CRDT_KEYS.BOOKS);
  }

  get annotations() {
    return this.doc.getArray<Annotation>(CRDT_KEYS.ANNOTATIONS);
  }

  get lexicon() {
    return this.doc.getArray<LexiconRule>(CRDT_KEYS.LEXICON);
  }

  get history() {
    return this.doc.getMap<Y.Array<string>>(CRDT_KEYS.HISTORY);
  }

  get readingList() {
    return this.doc.getMap<ReadingListEntry>(CRDT_KEYS.READING_LIST);
  }

  get transient() {
    return this.doc.getMap<TTSPosition>(CRDT_KEYS.TRANSIENT);
  }

  /**
   * Encodes the current state of the document as a binary update.
   * This is used for syncing with other devices.
   */
  getUpdate(targetStateVector?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, targetStateVector);
  }

  /**
   * Applies a binary update from another device.
   */
  applyUpdate(update: Uint8Array) {
    Y.applyUpdate(this.doc, update);
  }

  /**
   * Generates a snapshot of the current state and returns its size.
   *
   * This is currently a diagnostic method to monitor the document size.
   *
   * @todo Implement full compaction strategy:
   * 1. Clear existing IndexedDB update logs.
   * 2. Write the single snapshot back to storage to reduce startup time/size.
   */
  async compact() {
    const snapshot = Y.encodeStateAsUpdate(this.doc);
    return snapshot.byteLength;
  }

  destroy() {
    this.provider.destroy();
    this.doc.destroy();
  }
}
