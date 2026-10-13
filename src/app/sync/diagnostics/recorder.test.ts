import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  classifyOrigin,
  getRecorderSnapshot,
  recordSyncEvent,
  resetSyncDiagnosticsRecorder,
  startSyncDiagnosticsRecorder,
} from './recorder';

const idb = { kind: 'idb-persistence' };
const isIdbOrigin = (o: unknown) => o === idb;

const EMPTY_SNAPSHOT = {
  recorderStartedAt: expect.any(Number),
  updateTotals: {},
  events: [],
  eventsDropped: 0,
  updates: [],
  updatesDropped: 0,
  lifecycle: [],
  lifecycleDropped: 0,
};

afterEach(() => resetSyncDiagnosticsRecorder());

describe('getRecorderSnapshot', () => {
  // First in the file on purpose: the rings must start empty before any
  // test has pushed (and the afterEach reset has run).
  it('starts empty: three empty rings, nothing dropped, no totals', () => {
    expect(getRecorderSnapshot()).toStrictEqual(EMPTY_SNAPSHOT);
  });

  it('reset drops every ring and the totals', () => {
    recordSyncEvent({ type: 'flushed', at: 1 });
    const doc = new Y.Doc();
    const stop = startSyncDiagnosticsRecorder({ doc, isIdbOrigin });
    doc.getMap('m').set('a', 1);
    stop();
    const before = getRecorderSnapshot();
    expect(before.events).toHaveLength(1);
    expect(before.updates).toHaveLength(1);
    expect(before.lifecycle).toHaveLength(1);
    expect(before.updateTotals.local?.count).toBe(1);

    resetSyncDiagnosticsRecorder();

    expect(getRecorderSnapshot()).toStrictEqual(EMPTY_SNAPSHOT);
  });
});

describe('classifyOrigin', () => {
  it('maps y-cinder string origins to remote classes', () => {
    expect(classifyOrigin('origin:firebase/snapshot', false, isIdbOrigin)).toBe('remote:snapshot');
    expect(classifyOrigin('origin:firebase/history', false, isIdbOrigin)).toBe('remote:history');
    expect(classifyOrigin('origin:firebase/update', false, isIdbOrigin)).toBe('remote:update');
    expect(classifyOrigin('origin:firebase/whatever', false, isIdbOrigin)).toBe('remote:other');
  });

  it('recognises the y-idb persistence origin, then falls back to the local flag', () => {
    expect(classifyOrigin(idb, false, isIdbOrigin)).toBe('idb');
    expect(classifyOrigin(null, true, isIdbOrigin)).toBe('local');
    expect(classifyOrigin({}, false, isIdbOrigin)).toBe('other');
    // Only the y-cinder prefix makes a string origin remote.
    expect(classifyOrigin('versicle:repair', true, isIdbOrigin)).toBe('local');
    expect(classifyOrigin('', false, isIdbOrigin)).toBe('other');
  });
});

describe('startSyncDiagnosticsRecorder', () => {
  it('records each doc update with its origin class, size and touched roots', () => {
    const doc = new Y.Doc();
    const stop = startSyncDiagnosticsRecorder({ doc, isIdbOrigin });

    doc.getMap('library').set('book-1', { title: 'x' });

    const remote = new Y.Doc();
    remote.getMap('progress').set('book-1', 0.5);
    const nested = new Y.Map<unknown>();
    remote.getMap('library').set('book-2', nested);
    nested.set('inner', 1);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), 'origin:firebase/update');

    stop();
    doc.getMap('library').set('book-3', 1); // after stop: not recorded

    const snap = getRecorderSnapshot();
    expect(snap.updates.map((u) => [u.origin, u.roots])).toEqual([
      ['local', ['library']],
      ['remote:update', ['library', 'progress']],
    ]);
    expect(snap.updates.every((u) => u.bytes > 0)).toBe(true);
    expect(snap.updateTotals.local?.count).toBe(1);
    expect(snap.updateTotals['remote:update']).toMatchObject({ count: 1 });
    expect(snap.updateTotals['remote:update']?.lastAt).toEqual(expect.any(Number));
  });

  it('attributes a change inside a pre-existing nested map to its top-level root', () => {
    const doc = new Y.Doc();
    const nested = new Y.Map<unknown>();
    doc.getMap('library').set('book-1', nested); // integrated before recording starts
    const stop = startSyncDiagnosticsRecorder({ doc, isIdbOrigin });

    nested.set('progress', 0.5);
    stop();

    expect(getRecorderSnapshot().updates.map((u) => u.roots)).toStrictEqual([['library']]);
  });

  it('accumulates per-origin totals: count, bytes, first and last arrival', () => {
    const doc = new Y.Doc();
    const stop = startSyncDiagnosticsRecorder({ doc, isIdbOrigin });
    doc.getMap('m').set('a', 'x'.repeat(10));
    doc.getMap('m').set('b', 'y'.repeat(100));
    stop();

    const snap = getRecorderSnapshot();
    const [first, second] = snap.updates;
    expect(second.bytes).toBeGreaterThan(first.bytes);
    expect(snap.updateTotals).toStrictEqual({
      local: { count: 2, bytes: first.bytes + second.bytes, firstAt: first.t, lastAt: second.t },
    });
    expect(snap.updateTotals.local!.firstAt).toBeLessThanOrEqual(snap.updateTotals.local!.lastAt!);
  });

  it('records every lifecycle transition, with its detail, until stopped', () => {
    const stop = startSyncDiagnosticsRecorder({ doc: new Y.Doc(), isIdbOrigin });
    for (const name of ['online', 'offline', 'pagehide', 'pageshow']) window.dispatchEvent(new Event(name));
    for (const name of ['visibilitychange', 'freeze', 'resume']) document.dispatchEvent(new Event(name));
    stop();
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));

    const t = expect.any(Number);
    expect(getRecorderSnapshot().lifecycle).toStrictEqual([
      {
        t,
        kind: 'recorder-started',
        detail: `online=${String(navigator.onLine)} visibility=${document.visibilityState}`,
      },
      { t, kind: 'online' },
      { t, kind: 'offline' },
      { t, kind: 'pagehide' },
      { t, kind: 'pageshow' },
      { t, kind: 'visibilitychange', detail: document.visibilityState },
      { t, kind: 'freeze' },
      { t, kind: 'resume' },
    ]);
  });

  it('keeps sync events in a bounded ring and counts what it dropped', () => {
    for (let i = 0; i < 510; i++) recordSyncEvent({ type: 'flushed', at: i });
    const snap = getRecorderSnapshot();
    expect(snap.events).toHaveLength(500);
    expect(snap.eventsDropped).toBe(10);
    expect(snap.events[0].event).toEqual({ type: 'flushed', at: 10 });
    expect(snap.events.at(-1)?.event).toEqual({ type: 'flushed', at: 509 });
  });
});
