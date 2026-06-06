# Feature request: bound write concurrency — coalesce `Y.Doc` updates into a single in‑flight `updates` transaction

**Package:** `y-indexeddb` (observed on `9.0.12`)
**Type:** robustness + performance improvement to the write path (no storage-format change)

---

## Summary

`IndexeddbPersistence` currently opens **one fire‑and‑forget `readwrite` transaction per `Y.Doc` update** and never awaits it. There is no bound on how many of these transactions can be in flight at once. Under a high update rate this creates an unbounded backlog of concurrent transactions against the single `updates` object store, which:

1. **Hangs IndexedDB on WebKit** (Safari / all iOS browsers): under load, the concurrent same‑store `readwrite` transactions stop progressing — they never fire `complete`/`error`/`abort` — which stalls the whole database connection.
2. Is **inefficient on every engine** (per‑update transaction overhead instead of batching).
3. **Silently drops write errors** (the request and transaction are never awaited, so a failed `add`/`abort`/`QuotaExceededError` is invisible).

We propose serializing writes to **at most one in‑flight transaction**, batching the updates that accumulate while a write is committing. This bounds concurrency to 1, eliminates the WebKit hang, reduces transaction count, and gives a place to surface write errors — **without changing the on‑disk format** (still individual update rows in the autoIncrement `updates` store) and with **near‑zero added persistence latency** in the recommended (microtask) mode.

---

## Current behavior

`y-indexeddb@9.0.12`, `src/y-indexeddb.js`, inside the `IndexeddbPersistence` constructor:

```js
this._storeUpdate = (update, origin) => {
  if (this.db && origin !== this) {
    const [updatesStore] = idb.transact(/** @type {IDBDatabase} */ (this.db), [updatesStoreName]) // readwrite
    idb.addAutoKey(updatesStore, update)                 // store.add(update) — NOT awaited
    if (++this._dbsize >= PREFERRED_TRIM_SIZE) {          // 500
      if (this._storeTimeoutId !== null) clearTimeout(this._storeTimeoutId)
      this._storeTimeoutId = setTimeout(() => {
        storeState(this, false)
        this._storeTimeoutId = null
      }, this._storeTimeout)                              // 1000ms
    }
  }
}
doc.on('update', this._storeUpdate)
```

Key properties of this path:

- **One `readwrite` transaction per update.** Every `Y.Doc` `update` event opens a fresh transaction on `updates`.
- **Fire‑and‑forget.** The `add` request and its transaction are never awaited. There is no backpressure and no error handling.
- **Unbounded concurrency.** If the document emits updates faster than IndexedDB commits them — bursts of edits, rapid programmatic mutations, frequent small state changes — an unbounded number of concurrent transactions accumulate against the same store.

(The periodic `storeState` compaction at `_dbsize >= 500` is debounced, but it only addresses *store size*, not the per‑update write concurrency described here.)

---

## The problem in detail

### 1. WebKit transaction stall (the concrete failure)

WebKit's IndexedDB implementation does not tolerate many concurrent `readwrite` transactions on the same object store well. We instrumented our app by wrapping `IDBFactory.prototype.open` and `IDBDatabase.prototype.transaction` (recording each transaction's stores/mode and whether it ever fired `complete`/`error`/`abort`) plus a `setTimeout` event‑loop heartbeat. Under a workload that emits frequent `Y.Doc` updates we observed, **on WebKit only**:

- Multiple `readwrite` transactions on the `updates` store left **outstanding for 5–16 seconds** (never settling).
- The stalled transactions **wedged the whole connection** — subsequent transactions, including read‑only ones on *other* stores, also stopped progressing.
- Multi‑second main‑thread event‑loop stalls correlated with the backlog.

Replacing the per‑update writer with a coalescing, single‑in‑flight writer (reference implementation below) **eliminated the outstanding `updates` transactions entirely** (max observed `updates` transaction duration dropped to well under 20 ms) and reduced the event‑loop stalls by roughly 3–10×. The same workload was already fine on Chromium; only the write *cadence* changed, not the data.

This matches the broader, long‑standing fragility of WebKit's IDB transaction scheduler under concurrency. Because Safari/iOS is a large share of browser traffic and `y-indexeddb` is fundamentally a *browser* persistence layer, this is worth handling in the library.

### 2. Efficiency (all engines)

Opening a transaction per update is pure overhead when many updates arrive in the same tick or in a tight burst. Batching N updates into one transaction is strictly cheaper and is invisible to the stored data (the rows written are identical).

### 3. Silent write failures

Because the write is never awaited, an `onerror`/`onabort` (e.g. `QuotaExceededError`, or a transaction killed by the engine) is silently dropped. A serialized writer naturally creates a single place to surface these (e.g. emit an `error` event) instead of losing updates without a trace.

---

## Proposed change

Replace the "one fire‑and‑forget transaction per update" writer with a **serialized, batched writer**:

- Buffer incoming updates in memory.
- Keep **at most one `updates` `readwrite` transaction in flight**. While a write is committing, new updates queue instead of opening additional transactions.
- When the in‑flight transaction completes, if the buffer is non‑empty, write the accumulated batch in **one** transaction (one `add` per update — identical rows to today).

The recommended default schedules the flush on a **microtask** (`queueMicrotask`), which coalesces an entire synchronous burst of updates into one transaction while adding **sub‑millisecond** latency. Crucially, **the microtask variant alone fixes the WebKit hang**, because the fix is *bounding concurrency to 1*, not *delaying writes*. A configurable time‑based debounce is an optional further optimization for apps that want to reduce write volume even more aggressively.

The stored bytes are unchanged: still one row per update in the autoIncrement `updates` store, so existing databases, the `synced` event, `fetchUpdates`, and `storeState`/trim all keep working. `_dbsize` is incremented per flushed update so the existing trim threshold still fires.

### Native integration sketch

This maps directly onto the existing `_storeUpdate` / `db` / `_dbsize` fields:

```js
// constructor additions
this._writeDebounceMs = options?.writeDebounceMs ?? 0  // 0 = coalesce via microtask (recommended)
this._pendingUpdates = []
this._flushScheduled = false
this._writing = false

this._storeUpdate = (update, origin) => {
  if (this.db && origin !== this) {
    this._pendingUpdates.push(update)
    this._scheduleFlush()
  }
}

// methods
_scheduleFlush () {
  if (this._flushScheduled || this._writing || this._destroyed) return
  this._flushScheduled = true
  if (this._writeDebounceMs > 0) {
    setTimeout(() => { this._flushScheduled = false; this._flush() }, this._writeDebounceMs)
  } else {
    queueMicrotask(() => { this._flushScheduled = false; this._flush() })
  }
}

_flush () {
  if (this._writing || this._destroyed || !this.db || this._pendingUpdates.length === 0) return
  this._writing = true
  const batch = this._pendingUpdates
  this._pendingUpdates = []
  const tx = this.db.transaction([updatesStoreName], 'readwrite')
  const store = tx.objectStore(updatesStoreName)
  for (let i = 0; i < batch.length; i++) store.add(batch[i]) // autoIncrement store; == idb.addAutoKey
  tx.oncomplete = () => {
    this._dbsize += batch.length
    this._writing = false
    if (this._pendingUpdates.length > 0) this._scheduleFlush()
    if (this._dbsize >= PREFERRED_TRIM_SIZE) { /* existing storeState() trim path */ }
  }
  tx.onerror = tx.onabort = () => {
    // Do NOT silently drop. Re-buffer and surface the error.
    this._pendingUpdates = batch.concat(this._pendingUpdates)
    this._writing = false
    this.emit('error', [tx.error]) // optional, but lets apps react to QuotaExceededError etc.
    this._scheduleFlush()
  }
}
```

### Durability flush points

To narrow the window where a hard reload/close could drop the last (sub‑millisecond) batch, flush on teardown and unload:

- In `destroy()`: flush `_pendingUpdates` before closing the DB.
- Add best‑effort listeners for `pagehide` / `visibilitychange === 'hidden'` (guarded by `typeof addEventListener`) that flush synchronously.

(Note: the *current* fire‑and‑forget path has no stronger unload guarantee — an un‑awaited `add` issued just before unload is not guaranteed to commit either. With a microtask flush + unload flush, the practical durability delta is small.)

---

## Suggested API

Minimal and backward‑compatible. Two reasonable options:

- **Default‑on (recommended).** Make the serialized/microtask‑batched writer the default, since it is a strict robustness win with negligible latency and no format change. Expose `writeDebounceMs?: number` for apps that want longer coalescing:

  ```js
  new IndexeddbPersistence(name, doc, { writeDebounceMs: 0 }) // default: microtask coalescing
  ```

- **Opt‑in (most conservative).** Keep current behavior as default; add `{ coalesceWrites: true, writeDebounceMs?: number }` to enable the new path. Lower risk for existing users; downside is that the WebKit hang remains the default behavior.

Either way, the storage format and existing events/APIs are unchanged.

---

## Backwards compatibility & risks

- **Storage format:** unchanged (individual update rows in the autoIncrement `updates` store). Existing databases load identically.
- **Ordering:** preserved — updates are flushed in arrival order within a batch, batches in order.
- **Durability:** the only behavioral change is that a write may be deferred by up to one microtask (default) or `writeDebounceMs` (if configured), vs. "issued immediately but un‑awaited" today. Mitigated by the unload/`destroy` flush. For apps that need stronger guarantees, `writeDebounceMs: 0` keeps the deferral at microtask granularity.
- **Error handling:** strictly improved (errors can be surfaced instead of silently dropped). If re‑buffering on error, bound retries / special‑case `QuotaExceededError` so a persistently failing write doesn't spin.
- **Trim/compaction:** unaffected, as long as `_dbsize` continues to be incremented per flushed update (the sketch does this).

---

## Alternatives considered

- **Hold one long‑lived transaction open.** Not viable: IndexedDB transactions auto‑commit when they go idle; you cannot keep one open across async gaps. Per‑batch transactions (single‑in‑flight) is the correct model.
- **Time‑based debounce only (no serialization).** A debounce reduces transaction count but, without an in‑flight bound, two debounced flushes can still overlap. Serialization (≤1 in flight) is the part that actually bounds concurrency and fixes the WebKit hang; the debounce is an optimization layered on top.
- **Fix it in userland (wrapper).** Possible but fragile: it requires detaching the library's bound `_storeUpdate` handler and reaching into `db` / `_dbsize`, which couples the app to private internals across versions, and it cannot cleanly coordinate with the library's trim/compaction. This is exactly why we think it belongs upstream.

---

## Reference implementation (proven, standalone)

We currently ship the following as a userland wrapper around `IndexeddbPersistence` (it detaches the built‑in `_storeUpdate` and installs a coalescing, single‑in‑flight writer). It has eliminated the WebKit hang in production‑like end‑to‑end tests. It is included here only as a working reference for the proposed behavior — a native implementation (sketched above) would be simpler because it wouldn't need to detach the built‑in handler.

```ts
import type * as Y from 'yjs'
import type { IndexeddbPersistence } from 'y-indexeddb'

const UPDATES_STORE = 'updates'

export function installCoalescedWriter (
  persistence: IndexeddbPersistence,
  doc: Y.Doc,
  opts: { flushMs?: number } = {}
) {
  const flushMs = opts.flushMs ?? 200 // 0/microtask is preferable in a native impl

  // Detach the built-in per-update writer.
  const builtin = (persistence as any)._storeUpdate as ((u: Uint8Array, o: unknown) => void)
  doc.off('update', builtin)

  const pending: Uint8Array[] = []
  let flushing = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let torn = false

  const getDb = (): IDBDatabase | null => ((persistence as any).db as IDBDatabase | null) ?? null

  const writeBatch = (db: IDBDatabase, batch: Uint8Array[]) => new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction
    try { tx = db.transaction([UPDATES_STORE], 'readwrite') } catch (e) { reject(e); return }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
    const store = tx.objectStore(UPDATES_STORE)
    for (const u of batch) store.add(u) // autoIncrement store
  })

  const runFlush = async () => {
    timer = null
    if (torn || flushing || pending.length === 0) return
    const db = getDb()
    if (!db) { schedule(); return } // db not open yet
    flushing = true
    const batch = pending.splice(0, pending.length)
    try {
      await writeBatch(db, batch)
      ;(persistence as any)._dbsize += batch.length // keep trim threshold accurate
    } catch (e) {
      pending.unshift(...batch) // re-buffer; do not drop
    } finally {
      flushing = false
      if (!torn && pending.length > 0) schedule()
    }
  }

  const schedule = () => {
    if (torn || timer !== null) return
    timer = setTimeout(() => { void runFlush() }, flushMs)
  }

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === persistence) return // skip updates applied while hydrating from IDB
    pending.push(update)
    schedule()
  }
  doc.on('update', onUpdate)

  // Best-effort durability flush on unload.
  const onUnload = () => {
    if (torn || flushing || pending.length === 0) return
    const db = getDb(); if (!db) return
    void writeBatch(db, pending.splice(0, pending.length)).catch(() => {})
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onUnload)
    window.addEventListener('beforeunload', onUnload)
  }

  return {
    async teardown () {
      torn = true
      if (timer !== null) { clearTimeout(timer); timer = null }
      doc.off('update', onUpdate)
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onUnload)
        window.removeEventListener('beforeunload', onUnload)
      }
      while (flushing) await new Promise(r => setTimeout(r, 10))
      const db = getDb()
      if (db && pending.length > 0) await writeBatch(db, pending.splice(0, pending.length)).catch(() => {})
    }
  }
}
```

---

## TL;DR for maintainers

- `_storeUpdate` opens **one un‑awaited `readwrite` transaction per update** with **no concurrency bound**.
- Under load this **hangs IndexedDB on WebKit**, is inefficient everywhere, and silently drops write errors.
- Proposed fix: **serialize writes to one in‑flight transaction**, batching updates that arrive while a write is committing; schedule the flush on a microtask by default (≈0 added latency) with an optional `writeDebounceMs`. **Same on‑disk format**, plus an unload/`destroy` flush.
- We have a proven userland implementation (above); a native version would be smaller. Happy to open a PR if the direction sounds good.
