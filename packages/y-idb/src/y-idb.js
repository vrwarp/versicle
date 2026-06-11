/* eslint-env browser */

import * as Y from 'yjs'
import * as idb from 'lib0/indexeddb'
import * as promise from 'lib0/promise'
import { Observable } from 'lib0/observable'

const customStoreName = 'custom'
const updatesStoreName = 'updates'

export const PREFERRED_TRIM_SIZE = 500

/**
 * @template T
 * @param {IndexeddbPersistence} idbPersistence
 * @param {() => Promise<T>} work
 * @return {Promise<T>}
 */
const transactWrite = (idbPersistence, work) => {
  if (idbPersistence.transactionRunner) {
    return idbPersistence.transactionRunner(work)
  }
  return work()
}

/**
 * @param {IndexeddbPersistence} idbPersistence
 * @param {function(IDBObjectStore):any} [beforeApplyUpdatesCallback]
 * @param {function(IDBObjectStore):void} [afterApplyUpdatesCallback]
 * @return {Promise<any>}
 */
const _fetchUpdates = (idbPersistence, beforeApplyUpdatesCallback, afterApplyUpdatesCallback) => {
  if (idbPersistence._destroyed) return promise.resolve()
  if (!idbPersistence.db) {
    return idbPersistence._db.then(db => {
      idbPersistence.db = db
      return _fetchUpdates(idbPersistence, beforeApplyUpdatesCallback, afterApplyUpdatesCallback)
    })
  }
  const [updatesStore] = idb.transact(/** @type {IDBDatabase} */ (idbPersistence.db), [updatesStoreName], 'readwrite')
  /**
   * @type {Array<Uint8Array>}
   */
  const updates = []
  return idb.iterate(updatesStore, idb.createIDBKeyRangeLowerBound(idbPersistence._dbref, false), (val) => {
    updates.push(val)
  }).then(() => {
    if (idbPersistence._destroyed) return
    if (beforeApplyUpdatesCallback) beforeApplyUpdatesCallback(updatesStore)
    Y.transact(idbPersistence.doc, () => {
      updates.forEach(val => Y.applyUpdate(idbPersistence.doc, val))
    }, idbPersistence, false)
    if (afterApplyUpdatesCallback) afterApplyUpdatesCallback(updatesStore)
  })
    .then(() => {
      if (idbPersistence._destroyed) return
      return idb.getLastKey(updatesStore).then(lastKey => {
        if (idbPersistence._destroyed) return
        idbPersistence._dbref = (lastKey === null || lastKey === undefined) ? 0 : lastKey + 1
      })
    })
    .then(() => {
      if (idbPersistence._destroyed) return
      return idb.count(updatesStore).then(cnt => {
        if (idbPersistence._destroyed) return
        idbPersistence._dbsize = cnt
      })
    })
    .then(() => updatesStore)
}

/**
 * @param {IndexeddbPersistence} idbPersistence
 * @param {function(IDBObjectStore):any} [beforeApplyUpdatesCallback]
 * @param {function(IDBObjectStore):void} [afterApplyUpdatesCallback]
 * @return {Promise<any>}
 */
export const fetchUpdates = (idbPersistence, beforeApplyUpdatesCallback, afterApplyUpdatesCallback) =>
  transactWrite(idbPersistence, () => _fetchUpdates(idbPersistence, beforeApplyUpdatesCallback, afterApplyUpdatesCallback))

/**
 * @param {IndexeddbPersistence} idbPersistence
 * @param {boolean} forceStore
 */
export const storeState = (idbPersistence, forceStore = true) =>
  transactWrite(idbPersistence, () =>
    _fetchUpdates(idbPersistence)
      .then(updatesStore => {
        if (idbPersistence._destroyed) return
        if (forceStore || idbPersistence._dbsize >= PREFERRED_TRIM_SIZE) {
          return idb.addAutoKey(updatesStore, Y.encodeStateAsUpdate(idbPersistence.doc))
            .then(() => {
              if (idbPersistence._destroyed) return
              return idb.del(updatesStore, idb.createIDBKeyRangeUpperBound(idbPersistence._dbref, true))
            })
            .then(() => {
              if (idbPersistence._destroyed) return
              return idb.count(updatesStore).then(cnt => {
                if (idbPersistence._destroyed) return
                idbPersistence._dbsize = cnt
              })
            })
        }
      })
  )

/**
 * @param {string} name
 */
export const clearDocument = name => idb.deleteDB(name)

/**
 * Write `update` as the COMPLETE content of database `name` using this
 * module's own store layout: open/create the database → clear `updates` →
 * add the single snapshot row → await the transaction commit → close.
 * (Versicle fork surgery 2, PROVENANCE.md: the snapshot-write primitive
 * consumers used to re-implement raw — layout knowledge lives here only.)
 *
 * Resolves only after the transaction has COMMITTED, so a page reload
 * immediately afterwards cannot lose the snapshot. The optional
 * `transactionRunner` wraps the whole open→commit→close unit (callers pass
 * their cross-context exclusive write gate).
 *
 * PRECONDITION: no live IndexeddbPersistence is bound to `name` (destroy it
 * first) — a concurrent binding could interleave its own update rows.
 *
 * @param {string} name
 * @param {Uint8Array} update
 * @param {object} [opts]
 * @param {<T>(work: () => Promise<T>) => Promise<T>} [opts.transactionRunner]
 * @return {Promise<void>}
 */
export const writeSnapshot = (name, update, { transactionRunner } = {}) => {
  const work = () => idb.openDB(name, db =>
    idb.createStores(db, [
      ['updates', { autoIncrement: true }],
      ['custom']
    ])
  ).then(db => new Promise((resolve, reject) => {
    /**
     * @type {IDBTransaction}
     */
    let tx
    try {
      tx = db.transaction([updatesStoreName], 'readwrite')
    } catch (e) {
      db.close()
      reject(e)
      return
    }
    // Raw requests on purpose (no promise wrappers): request failures
    // surface through tx.onerror below instead of dangling rejections.
    const store = tx.objectStore(updatesStoreName)
    store.clear()
    store.add(update)
    tx.oncomplete = () => {
      db.close()
      resolve(undefined)
    }
    tx.onerror = tx.onabort = () => {
      db.close()
      reject(tx.error || new Error('writeSnapshot transaction failed'))
    }
  }))
  return transactionRunner ? transactionRunner(work) : work()
}

/**
 * @extends Observable<string>
 */
export class IndexeddbPersistence extends Observable {
  /**
   * @param {string} name
   * @param {Y.Doc} doc
   * @param {object} [opts]
   * @param {number} [opts.writeDebounceMs]
   * @param {'default'|'relaxed'} [opts.durability]
   * @param {<T>(work: () => Promise<T>) => Promise<T>} [opts.transactionRunner]
   */
  constructor (name, doc, { writeDebounceMs = 0, durability = 'default', transactionRunner } = {}) {
    super()
    this.doc = doc
    this.name = name
    this._dbref = 0
    this._dbsize = 0
    this._destroyed = false
    this.writeDebounceMs = writeDebounceMs
    this.durability = durability
    this.transactionRunner = transactionRunner
    this._retryCount = 0
    this._maxRetries = 5
    /**
     * @type {Promise<any>|null}
     */
    this._flushPromise = null
    /**
     * @type {Promise<void>|null}
     */
    this._destroyPromise = null
    /**
     * @type {Array<Uint8Array>}
     */
    this._pendingUpdates = []
    this._writing = false
    this._flushScheduled = false
    /**
     * @type {IDBDatabase|null}
     */
    this.db = null
    this.synced = false
    this._db = idb.openDB(name, db =>
      idb.createStores(db, [
        ['updates', { autoIncrement: true }],
        ['custom']
      ])
    )
    /**
     * @type {Promise<IndexeddbPersistence>}
     */
    this.whenSynced = promise.create(resolve => this.on('synced', () => resolve(this)))

    this._db.then(db => {
      this.db = db
      /**
       * @param {IDBObjectStore} updatesStore
       */
      const beforeApplyUpdatesCallback = (updatesStore) => {
        const initUpdate = Y.encodeStateAsUpdate(doc)
        if (initUpdate.length > 2) {
          return idb.addAutoKey(updatesStore, initUpdate)
        }
      }
      // 'synced' durability (Versicle fork surgery 3, PROVENANCE.md): the
      // emit is deferred to the hydration transaction's `complete` event —
      // that transaction carries the initial-state write above, so
      // `whenSynced` now guarantees the write COMMITTED, not merely issued.
      // Stored updates are still applied to the doc strictly before the
      // emit (contract Y.7/Y.10b). The fetchUpdates promise chain settles
      // inside the success callback of the transaction's last request,
      // strictly before the `complete` event task dispatches, so attaching
      // the handler here cannot miss it. On abort/error the emit still
      // happens (legacy behavior — consumers must not wedge; the data has
      // been applied to the in-memory doc either way).
      fetchUpdates(this, beforeApplyUpdatesCallback).then(updatesStore => {
        if (this._destroyed || !updatesStore) return
        const emitSynced = () => {
          if (this._destroyed) return
          this.synced = true
          this.emit('synced', [this])
          this._scheduleFlush()
        }
        const tx = updatesStore.transaction
        tx.oncomplete = emitSynced
        tx.onerror = emitSynced
        tx.onabort = emitSynced
      })
    })
    /**
     * Timeout in ms until data is merged and persisted in idb.
     */
    this._storeTimeout = 1000
    /**
     * @type {any}
     */
    this._storeTimeoutId = null
    /**
     * @param {Uint8Array} update
     * @param {any} origin
     */
    this._storeUpdate = (update, origin) => {
      if (origin !== this) {
        this._pendingUpdates.push(update)
        this._scheduleFlush()
      }
    }
    doc.on('update', this._storeUpdate)
    this.destroy = this.destroy.bind(this)
    doc.on('destroy', this.destroy)

    this._unloadListener = () => {
      if (this.db && this._pendingUpdates.length > 0) {
        const batch = this._pendingUpdates.splice(0, this._pendingUpdates.length)
        try {
          const tx = this.db.transaction([updatesStoreName], 'readwrite')
          const store = tx.objectStore(updatesStoreName)
          for (let i = 0; i < batch.length; i++) {
            idb.addAutoKey(store, batch[i])
          }
          tx.onerror = tx.onabort = () => {
            if (!this._destroyed) {
              this._pendingUpdates = batch.concat(this._pendingUpdates)
            }
          }
        } catch (e) {
          if (!this._destroyed) {
            this._pendingUpdates = batch.concat(this._pendingUpdates)
          }
        }
      }
    }
    if (typeof addEventListener !== 'undefined') {
      addEventListener('pagehide', this._unloadListener)
    }
    if (typeof document !== 'undefined') {
      this._visibilityListener = () => {
        if (document.visibilityState === 'hidden') {
          this._unloadListener()
        }
      }
      document.addEventListener('visibilitychange', this._visibilityListener)
    }
  }

  _scheduleFlush () {
    if (this._destroyed || this._writing || this._pendingUpdates.length === 0) return
    if (this._flushScheduled) return
    this._flushScheduled = true
    if (this.writeDebounceMs > 0) {
      setTimeout(() => {
        this._flushScheduled = false
        this._flush()
      }, this.writeDebounceMs)
    } else {
      queueMicrotask(() => {
        this._flushScheduled = false
        this._flush()
      })
    }
  }

  _flush () {
    if (this._destroyed || this._writing || this._pendingUpdates.length === 0) return
    const db = this.db
    if (!db) {
      // Don't re-schedule here — the _db.then() callback in the constructor
      // will call _scheduleFlush() once the database is ready. Re-scheduling
      // via queueMicrotask would create an infinite spin-loop that starves
      // the event loop and prevents _db from ever resolving.
      return
    }
    this._writing = true
    const batch = this._pendingUpdates
    this._pendingUpdates = []
    this._flushPromise = transactWrite(this, () => new Promise(resolve => {
      /**
       * @type {IDBTransaction}
       */
      let tx
      try {
        tx = db.transaction([updatesStoreName], 'readwrite', { durability: this.durability })
      } catch (e) {
        this._pendingUpdates = batch.concat(this._pendingUpdates)
        this._writing = false
        this._flushPromise = null
        this.emit('error', [e])
        resolve(undefined)
        return
      }
      const store = tx.objectStore(updatesStoreName)
      for (let i = 0; i < batch.length; i++) {
        idb.addAutoKey(store, batch[i])
      }
      tx.oncomplete = () => {
        this._retryCount = 0
        this._dbsize += batch.length
        this._writing = false
        this._flushPromise = null
        if (this._pendingUpdates.length > 0) {
          this._scheduleFlush()
        }
        if (this._dbsize >= PREFERRED_TRIM_SIZE) {
          if (this._storeTimeoutId !== null) {
            clearTimeout(this._storeTimeoutId)
          }
          this._storeTimeoutId = setTimeout(() => {
            storeState(this, false)
            this._storeTimeoutId = null
          }, this._storeTimeout)
        }
        resolve(undefined)
      }
      const onErrorOrAbort = () => {
        this._pendingUpdates = batch.concat(this._pendingUpdates)
        this._writing = false
        this._flushPromise = null
        this.emit('error', [tx.error])
        if (!this._destroyed) {
          this._retryCount++
          if (this._retryCount <= this._maxRetries) {
            const backoff = Math.pow(2, this._retryCount) * 100
            setTimeout(() => {
              this._scheduleFlush()
            }, backoff)
          } else {
            this._retryCount = 0
            this.emit('retry-exhausted', [tx.error || new Error('Retry exhausted')])
          }
        }
        resolve(undefined)
      }
      tx.onerror = onErrorOrAbort
      tx.onabort = onErrorOrAbort
    }))
  }

  /**
   * Force-drain the pending update queue NOW, bypassing the
   * `writeDebounceMs` timer (Versicle fork surgery 1, PROVENANCE.md):
   * runs `_flush()` immediately, awaits the in-flight transaction commit
   * (the existing `_flushPromise` resolves in the transaction's
   * `oncomplete`/`onerror`), and loops until `_pendingUpdates` is empty
   * with no flush in flight — updates that arrive mid-flush are drained
   * too. Resolves immediately when idle. While the error-retry path is
   * active (`_retryCount > 0`), waits for the scheduled backoff retry
   * instead of hot-spinning a failing transaction; on persistent failure
   * this keeps retrying like the internal machinery does (callers that
   * need a bound race it against a deadline).
   *
   * A debounce timer that is already scheduled is left to fire: its
   * `_flush()` no-ops once the queue has been drained here.
   *
   * @return {Promise<void>}
   */
  async flush () {
    await this._db
    for (;;) {
      if (this._flushPromise) {
        await this._flushPromise
        continue
      }
      if (this._destroyed || this._pendingUpdates.length === 0) return
      if (this._retryCount > 0) {
        // A backoff retry is pending (see onErrorOrAbort) — yield until its
        // _scheduleFlush fires rather than re-issuing the transaction hot.
        await new Promise(resolve => setTimeout(resolve, 50))
        continue
      }
      this._flush()
      if (!this._flushPromise) {
        // _flush declined to run (connection mid-open or a races with the
        // debounce timer's own run) — yield and re-check.
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
  }

  destroy () {
    if (this._destroyPromise) {
      return this._destroyPromise
    }
    if (this._storeTimeoutId) {
      clearTimeout(this._storeTimeoutId)
    }
    this.doc.off('update', this._storeUpdate)
    this.doc.off('destroy', this.destroy)
    this._destroyed = true
    if (typeof addEventListener !== 'undefined') {
      removeEventListener('pagehide', this._unloadListener)
    }
    if (typeof document !== 'undefined' && this._visibilityListener) {
      document.removeEventListener('visibilitychange', this._visibilityListener)
    }

    const db = this.db
    let flushPromise = Promise.resolve()
    if (db && this._pendingUpdates.length > 0) {
      const batch = this._pendingUpdates.splice(0, this._pendingUpdates.length)
      flushPromise = transactWrite(this, () => new Promise((resolve) => {
        try {
          const tx = db.transaction([updatesStoreName], 'readwrite', { durability: this.durability })
          const store = tx.objectStore(updatesStoreName)
          for (let i = 0; i < batch.length; i++) {
            idb.addAutoKey(store, batch[i])
          }
          tx.oncomplete = () => resolve(undefined)
          tx.onerror = tx.onabort = () => resolve(undefined)
        } catch (e) {
          resolve(undefined)
        }
      }))
    }

    const activeFlushPromise = this._flushPromise || Promise.resolve()

    this._destroyPromise = Promise.all([flushPromise, activeFlushPromise]).then(() => this._db.then(db => {
      db.close()
    }))
    return this._destroyPromise
  }

  /**
   * Destroys this instance and removes all data from indexeddb.
   *
   * @return {Promise<void>}
   */
  clearData () {
    return this.destroy().then(() => idb.deleteDB(this.name))
  }

  /**
   * @param {String | number | ArrayBuffer | Date} key
   * @return {Promise<String | number | ArrayBuffer | Date | any>}
   */
  get (key) {
    return this._db.then(db => {
      const [custom] = idb.transact(db, [customStoreName], 'readonly')
      return idb.get(custom, key)
    })
  }

  /**
   * @param {String | number | ArrayBuffer | Date} key
   * @param {String | number | ArrayBuffer | Date} value
   * @return {Promise<String | number | ArrayBuffer | Date>}
   */
  set (key, value) {
    return this._db.then(db =>
      transactWrite(this, () => {
        const [custom] = idb.transact(db, [customStoreName])
        return idb.put(custom, value, key)
      })
    )
  }

  /**
   * @param {String | number | ArrayBuffer | Date} key
   * @return {Promise<undefined>}
   */
  del (key) {
    return this._db.then(db =>
      transactWrite(this, () => {
        const [custom] = idb.transact(db, [customStoreName])
        return idb.del(custom, key)
      })
    )
  }
}
