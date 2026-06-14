export const PREFERRED_TRIM_SIZE: 500;
export function fetchUpdates(idbPersistence: IndexeddbPersistence, beforeApplyUpdatesCallback?: ((arg0: IDBObjectStore) => any) | undefined, afterApplyUpdatesCallback?: ((arg0: IDBObjectStore) => void) | undefined): Promise<any>;
export function storeState(idbPersistence: IndexeddbPersistence, forceStore?: boolean): Promise<void | undefined>;
export function clearDocument(name: string): Promise<any>;
/**
 * Write `update` as the COMPLETE content of database `name` (the fork's own
 * store layout): open/create → clear `updates` → add the single snapshot
 * row → await the transaction commit → close. Resolves only after the
 * commit. PRECONDITION: no live IndexeddbPersistence is bound to `name`.
 * (Versicle fork surgery 2 — see PROVENANCE.md.)
 */
export function writeSnapshot(name: string, update: Uint8Array, opts?: {
    transactionRunner?: (<T>(work: () => Promise<T>) => Promise<T>) | undefined;
} | undefined): Promise<void>;
/**
 * Read the COMPLETE persisted state of database `name` as one merged Yjs
 * update, without constructing an IndexeddbPersistence binding. Resolves
 * `null` when the database holds no update rows. (Versicle fork surgery 4 —
 * see PROVENANCE.md.)
 */
export function readSnapshot(name: string, opts?: {
    transactionRunner?: (<T>(work: () => Promise<T>) => Promise<T>) | undefined;
} | undefined): Promise<Uint8Array | null>;
/**
 * @extends Observable<string>
 */
export class IndexeddbPersistence extends Observable<string> {
    /**
     * @param {string} name
     * @param {Y.Doc} doc
     * @param {object} [opts]
     * @param {number} [opts.writeDebounceMs]
     * @param {'default'|'relaxed'} [opts.durability]
     * @param {<T>(work: () => Promise<T>) => Promise<T>} [opts.transactionRunner]
     */
    constructor(name: string, doc: Y.Doc, { writeDebounceMs, durability, transactionRunner }?: {
        writeDebounceMs?: number | undefined;
        durability?: "default" | "relaxed" | undefined;
        transactionRunner?: (<T>(work: () => Promise<T>) => Promise<T>) | undefined;
    } | undefined);
    doc: Y.Doc;
    name: string;
    _dbref: number;
    _dbsize: number;
    _destroyed: boolean;
    writeDebounceMs: number;
    durability: "default" | "relaxed";
    transactionRunner: (<T>(work: () => Promise<T>) => Promise<T>) | undefined;
    _retryCount: number;
    _maxRetries: number;
    /**
     * @type {Promise<any>|null}
     */
    _flushPromise: Promise<any> | null;
    /**
     * @type {Promise<void>|null}
     */
    _destroyPromise: Promise<void> | null;
    /**
     * @type {Array<Uint8Array>}
     */
    _pendingUpdates: Array<Uint8Array>;
    _writing: boolean;
    _flushScheduled: boolean;
    /**
     * @type {IDBDatabase|null}
     */
    db: IDBDatabase | null;
    synced: boolean;
    _db: Promise<IDBDatabase>;
    /**
     * @type {Promise<IndexeddbPersistence>}
     */
    whenSynced: Promise<IndexeddbPersistence>;
    /**
     * Timeout in ms until data is merged and persisted in idb.
     */
    _storeTimeout: number;
    /**
     * @type {any}
     */
    _storeTimeoutId: any;
    /**
     * @param {Uint8Array} update
     * @param {any} origin
     */
    _storeUpdate: (update: Uint8Array, origin: any) => void;
    destroy(): Promise<void>;
    _unloadListener: () => void;
    _visibilityListener: (() => void) | undefined;
    _scheduleFlush(): void;
    _flush(): void;
    /**
     * Force-drain the pending update queue NOW, bypassing the
     * `writeDebounceMs` timer; resolves once every queued update (including
     * ones arriving mid-flush) is handed to a COMMITTED transaction.
     * Resolves immediately when idle. (Versicle fork surgery 1 — see
     * PROVENANCE.md.)
     */
    flush(): Promise<void>;
    /**
     * Destroys this instance and removes all data from indexeddb.
     *
     * @return {Promise<void>}
     */
    clearData(): Promise<void>;
    /**
     * @param {String | number | ArrayBuffer | Date} key
     * @return {Promise<String | number | ArrayBuffer | Date | any>}
     */
    get(key: string | number | ArrayBuffer | Date): Promise<string | number | ArrayBuffer | Date | any>;
    /**
     * @param {String | number | ArrayBuffer | Date} key
     * @param {String | number | ArrayBuffer | Date} value
     * @return {Promise<String | number | ArrayBuffer | Date>}
     */
    set(key: string | number | ArrayBuffer | Date, value: string | number | ArrayBuffer | Date): Promise<string | number | ArrayBuffer | Date>;
    /**
     * @param {String | number | ArrayBuffer | Date} key
     * @return {Promise<undefined>}
     */
    del(key: string | number | ArrayBuffer | Date): Promise<undefined>;
}
import { Observable } from 'lib0/observable';
import * as Y from 'yjs';
