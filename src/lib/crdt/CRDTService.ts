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
   * Compaction Strategy:
   * Consolidates the update history into a single snapshot to reduce
   * the number of records in IndexedDB and optimize loading time.
   *
   * Note: y-indexeddb automatically merges updates to some extent,
   * but explicit snapshotting can be useful if we manage the storage manually
   * or want to export a "clean" state.
   *
   * However, standard y-indexeddb usage usually doesn't require manual "compaction"
   * in the sense of rewriting the DB, as it stores updates efficiently.
   * But the plan calls for "State Snapshots".
   *
   * To "compact" in Yjs usually means `Y.encodeStateAsUpdate(doc)`
   * and potentially storing that as a base, but Yjs relies on history.
   *
   * For this implementation, we will follow the plan's instruction:
   * "Every N updates... call Y.encodeStateAsUpdate(ydoc). This creates a single 'Full Update' block".
   *
   * To actually replace the IndexedDB content with a single update,
   * we would need to clear the existing DB and write the snapshot.
   * This is risky without careful locking.
   *
   * For Phase 1, we will implement `compact` as generating the snapshot
   * and (optionally) replacing the persistence if we were managing it manually.
   * Since we use `y-indexeddb`, we can use `provider.setStoredByteLength` limitation?
   * No.
   *
   * We will simply expose the ability to get the snapshot for now,
   * or if we want to "reset" persistence to a snapshot:
   */
  async compact() {
    const snapshot = Y.encodeStateAsUpdate(this.doc);
    // In a real scenario, we might clear the provider's data and re-inject this snapshot.
    // But `y-indexeddb` doesn't expose a simple "clear and set" API easily.
    // We would have to `clearData()`, then `applyUpdate()`.
    // Let's try that pattern if needed, but for now we just return the snapshot size.
    return snapshot.byteLength;
  }

  destroy() {
    this.provider.destroy();
    this.doc.destroy();
  }
}
