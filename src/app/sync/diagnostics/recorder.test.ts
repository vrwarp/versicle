import { describe, it, expect, beforeEach } from 'vitest';
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

beforeEach(() => resetSyncDiagnosticsRecorder());

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

  it('records lifecycle transitions until stopped', () => {
    const stop = startSyncDiagnosticsRecorder({ doc: new Y.Doc(), isIdbOrigin });
    window.dispatchEvent(new Event('offline'));
    document.dispatchEvent(new Event('visibilitychange'));
    stop();
    window.dispatchEvent(new Event('online'));

    const kinds = getRecorderSnapshot().lifecycle.map((l) => l.kind);
    expect(kinds).toEqual(['recorder-started', 'offline', 'visibilitychange']);
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
