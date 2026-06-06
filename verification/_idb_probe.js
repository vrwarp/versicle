// verification/_idb_probe.js
//
// TEST-ONLY instrumentation, injected via addInitScript when TTS_IDB_PROBE=1.
// It exists to turn "IndexedDB is the bottleneck" from a hypothesis into evidence.
//
// It records, at the page level (so it captures app DBService transactions AND Yjs's
// y-indexeddb persistence uniformly):
//   1. Every IndexedDB transaction: when it started, whether/when it settled, its
//      duration, and which object store(s) it touched. A transaction that starts but
//      never fires 'complete'/'error'/'abort' is a genuine hang. The `stores` field
//      lets us attribute a hang to the app (cache_session_state, static_*) vs Yjs.
//   2. Every IDBFactory.open(): same, to catch a getDB() that never opens.
//   3. An event-loop heartbeat (setTimeout-based): the gap between beats measures how
//      long the macrotask queue was starved — this is exactly the anomaly where a
//      timeout failed to fire during the resume wedge. Big gaps => the main thread /
//      event loop was blocked, not merely slow disk I/O.
//
// Read it via window.__idbProbe.summary().
(function () {
  if (window.__idbProbe) return;
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);

  const probe = {
    txns: [],   // { id, stores, mode, start, end, dur, settled, how }
    opens: [],  // { name, start, end, dur, settled, blocked }
    maxLoopGap: 0,
    loopGaps: [], // { at, gap } for gaps > 250ms
  };
  let txId = 0;
  window.__idbProbe = probe;

  probe.summary = function () {
    const outstanding = probe.txns
      .filter((t) => !t.settled)
      .map((t) => ({ stores: t.stores, mode: t.mode, ageMs: now() - t.start, at: t.stack }));
    const settled = probe.txns.filter((t) => t.settled);
    const durs = settled.map((t) => t.dur).sort((a, b) => a - b);
    const slow = settled
      .filter((t) => t.dur > 1000)
      .map((t) => ({ stores: t.stores, mode: t.mode, dur: t.dur, how: t.how }));
    // duration by store, to see which store is slow
    const byStore = {};
    for (const t of settled) {
      const k = t.stores;
      (byStore[k] = byStore[k] || []).push(t.dur);
    }
    const storeMax = {};
    for (const k in byStore) storeMax[k] = Math.max.apply(null, byStore[k]);
    return {
      txnCount: probe.txns.length,
      outstandingTxns: outstanding,           // started, never completed = HANG
      slowTxns: slow,                         // completed but > 1s
      txnDurMaxMs: durs.length ? durs[durs.length - 1] : 0,
      txnDurP50Ms: durs.length ? durs[Math.floor(durs.length / 2)] : 0,
      storeMaxMs: storeMax,                   // worst duration per object store
      openOutstanding: probe.opens.filter((o) => !o.settled).map((o) => ({ name: o.name, ageMs: now() - o.start, blocked: !!o.blocked })),
      openMaxMs: probe.opens.filter((o) => o.settled).reduce((m, o) => Math.max(m, o.dur), 0),
      maxLoopGapMs: Math.round(probe.maxLoopGap),  // biggest event-loop stall (setTimeout starvation)
      loopGaps: probe.loopGaps.slice(-15),
    };
  };

  // --- Event-loop macrotask heartbeat ---
  let last = performance.now();
  (function beat() {
    const t = performance.now();
    const gap = t - last;
    last = t;
    if (gap > probe.maxLoopGap) probe.maxLoopGap = gap;
    if (gap > 250) probe.loopGaps.push({ at: now(), gap: Math.round(gap) });
    setTimeout(beat, 30);
  })();

  // --- IDBFactory.open timing ---
  try {
    if (window.IDBFactory && IDBFactory.prototype.open) {
      const origOpen = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name, version) {
        const rec = { name: String(name), start: now(), end: null, settled: false };
        probe.opens.push(rec);
        const req = origOpen.apply(this, arguments);
        const settle = () => {
          if (rec.settled) return;
          rec.settled = true;
          rec.end = now();
          rec.dur = rec.end - rec.start;
        };
        try {
          req.addEventListener('success', settle);
          req.addEventListener('error', settle);
          req.addEventListener('blocked', () => { rec.blocked = true; });
        } catch (e) { /* ignore */ }
        return req;
      };
    }
  } catch (e) { /* ignore */ }

  // --- IDBDatabase.transaction tracking ---
  try {
    if (window.IDBDatabase && IDBDatabase.prototype.transaction) {
      const origTxn = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode) {
        const tx = origTxn.apply(this, arguments);
        // Capture a trimmed stack so an outstanding (hung) txn can be attributed to the
        // exact call site that opened it. Drop the top 2 frames (this wrapper + Error).
        let stack = '';
        try {
          stack = (new Error().stack || '')
            .split('\n')
            .slice(2, 8)
            .map((s) => s.trim())
            .join(' <- ');
        } catch (e) { /* ignore */ }
        const rec = {
          id: txId++,
          stores: Array.isArray(stores) ? stores.join(',') : String(stores),
          mode: mode || 'readonly',
          start: now(),
          end: null,
          settled: false,
          stack,
        };
        probe.txns.push(rec);
        const settle = (how) => {
          if (rec.settled) return;
          rec.settled = true;
          rec.how = how;
          rec.end = now();
          rec.dur = rec.end - rec.start;
        };
        try {
          tx.addEventListener('complete', () => settle('complete'));
          tx.addEventListener('error', () => settle('error'));
          tx.addEventListener('abort', () => settle('abort'));
        } catch (e) { /* ignore */ }
        return tx;
      };
    }
  } catch (e) { /* ignore */ }
})();
