import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { fnv1a, stableStringify, summarizeDoc } from './docSummary';

describe('hash helpers', () => {
  it('stableStringify is key-order independent', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(
      stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 })
    );
    expect(stableStringify({ a: 1, gone: undefined })).toBe(stableStringify({ a: 1 }));
    expect(fnv1a('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
  });
});

describe('summarizeDoc', () => {
  it('equal content on two replicas yields equal per-entry hashes and digests', () => {
    const a = new Y.Doc();
    a.getMap('library').set('book-1', { title: 'T', addedAt: 1_700_000_000_000 });
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    b.getMap('library'); // make the root typed on b too

    const sa = summarizeDoc(a) as { shared: Record<string, { digest: string; entries: Record<string, unknown> }> };
    const sb = summarizeDoc(b) as typeof sa;
    expect(sa.shared.library.digest).toBe(sb.shared.library.digest);
    expect(sa.shared.library.entries['book-1']).toEqual({
      h: expect.stringMatching(/^[0-9a-f]{8}$/),
      ts: { addedAt: 1_700_000_000_000 },
    });

    b.getMap('library').set('book-1', { title: 'T2', addedAt: 1_700_000_000_000 });
    const sb2 = summarizeDoc(b) as typeof sa;
    expect(sb2.shared.library.digest).not.toBe(sa.shared.library.digest);
  });

  it('reports the state vector (self marked) and pending structs blocked on a missing update', () => {
    const src = new Y.Doc();
    const updates: Uint8Array[] = [];
    src.on('update', (u: Uint8Array) => updates.push(u));
    src.getMap('m').set('a', 1);
    src.getMap('m').set('b', 2);

    const dst = new Y.Doc();
    Y.applyUpdate(dst, updates[1]); // skip the first: second is blocked

    const s = summarizeDoc(dst) as {
      stateVector: unknown[];
      pendingStructs: { missing: Record<string, number> } | null;
    };
    expect(s.pendingStructs?.missing).toEqual({ [src.clientID]: 0 });

    dst.getMap('m').set('own', 1);
    const s2 = summarizeDoc(dst) as { stateVector: Array<{ client: number; self: boolean }> };
    expect(s2.stateVector).toContainEqual(expect.objectContaining({ client: dst.clientID, self: true }));
  });

  it('reports untyped roots (data that arrived but was never accessed locally)', () => {
    const a = new Y.Doc();
    a.getMap('stranger').set('k', 1);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const s = summarizeDoc(b) as { shared: Record<string, { kind: string; size: number }> };
    expect(s.shared.stranger).toMatchObject({ kind: 'untyped', size: 1 });
  });
});
