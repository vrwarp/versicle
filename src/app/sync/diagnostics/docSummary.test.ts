import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { fnv1a, stableStringify, summarizeDoc } from './docSummary';

describe('hash helpers', () => {
  it('fnv1a matches the reference 32-bit FNV-1a vectors, zero-padded to 8 hex digits', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
    // A hash below 0x10000000 keeps its leading zero (fixed-width digests).
    expect(fnv1a('sync')).toBe('097acf9a');
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
  });

  it('stableStringify is key-order independent', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(
      stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 })
    );
    expect(stableStringify({ a: 1, gone: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it('stableStringify renders every value kind deterministically', () => {
    expect(stableStringify(undefined)).toBe('undefined');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(3)).toBe('3');
    expect(stableStringify('s')).toBe('"s"');
    expect(stableStringify(true)).toBe('true');
    expect(stableStringify([1, [2, 3]])).toBe('[1,[2,3]]');
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(stableStringify({ b: { d: 4, c: 3 }, a: [] })).toBe('{"a":[],"b":{"c":3,"d":4}}');
    expect(stableStringify(new Uint8Array([1, 2, 3]))).toBe(`bytes:3:${fnv1a('1,2,3')}`);
    // JSON.stringify has no rendering for these: fall back to String().
    expect(stableStringify(Symbol('tag'))).toBe('Symbol(tag)');
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

  it('pins the map summary: per-entry hash of the plain value, digest over sorted "key=hash" pairs', () => {
    const doc = new Y.Doc();
    const lib = doc.getMap('library');
    lib.set('b', { title: 'B' });
    lib.set('a', { title: 'A' });
    const nested = new Y.Map<unknown>();
    lib.set('n', nested);
    nested.set('inner', 1); // a nested Y type hashes as its plain JSON

    const hA = fnv1a(stableStringify({ title: 'A' }));
    const hB = fnv1a(stableStringify({ title: 'B' }));
    const hN = fnv1a(stableStringify({ inner: 1 }));
    expect(summarizeDoc(doc).shared.library).toStrictEqual({
      kind: 'map',
      size: 3,
      digest: fnv1a(`a=${hA}|b=${hB}|n=${hN}`),
      entries: { a: { h: hA }, b: { h: hB }, n: { h: hN } },
    });
  });

  it('orders the state vector highest clock first and marks only this doc as self', () => {
    const two = new Y.Doc();
    two.getMap('m').set('a', 1);
    two.getMap('m').set('b', 2);
    const three = new Y.Doc();
    three.getMap('m').set('a', 1);
    three.getMap('m').set('b', 2);
    three.getMap('m').set('c', 3);
    // Integrate in the order 2, 3, 1 so neither insertion order nor its
    // reverse is the expected (descending) order.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(two));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(three));
    doc.getMap('m').set('mine', 1);

    const s = summarizeDoc(doc);
    expect(s.stateVector).toStrictEqual([
      { client: three.clientID, clock: 3, self: false },
      { client: two.clientID, clock: 2, self: false },
      { client: doc.clientID, clock: 1, self: true },
    ]);
    expect(s.clientID).toBe(doc.clientID);
    expect(s.gc).toBe(true);
    expect(s.encodedStateBytes).toBe(Y.encodeStateAsUpdate(doc).byteLength);
    expect(s.pendingStructs).toBeNull();
    expect(s.pendingDeleteSetBytes).toBe(0);
    expect(s.metaSchemaVersion).toBeNull();
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

  it('reports a pending delete set (a deletion whose target never arrived)', () => {
    const src = new Y.Doc();
    const updates: Uint8Array[] = [];
    src.on('update', (u: Uint8Array) => updates.push(u));
    src.getMap('m').set('a', 1);
    src.getMap('m').delete('a');

    const dst = new Y.Doc();
    Y.applyUpdate(dst, updates[1]); // the delete alone: nothing to delete yet

    const s = summarizeDoc(dst);
    expect(s.pendingStructs).toBeNull();
    expect(s.pendingDeleteSetBytes).toBeGreaterThan(0);
  });

  it('reports the meta schemaVersion only when the meta map carries one', () => {
    const doc = new Y.Doc();
    expect(summarizeDoc(doc).metaSchemaVersion).toBeNull();
    doc.getMap('meta');
    expect(summarizeDoc(doc).metaSchemaVersion).toBeNull();
    doc.getMap('meta').set('schemaVersion', 7);
    expect(summarizeDoc(doc).metaSchemaVersion).toBe(7);
  });

  it('summarizes array and text roots by content digest', () => {
    const doc = new Y.Doc();
    doc.getArray('order').push(['x', 'y']);
    doc.getText('notes').insert(0, 'hello');

    const s = summarizeDoc(doc);
    expect(s.shared.order).toStrictEqual({ kind: 'array', size: 2, digest: fnv1a(stableStringify(['x', 'y'])) });
    expect(s.shared.notes).toStrictEqual({ kind: 'text', size: 5, digest: fnv1a('hello') });
  });

  it('reports untyped roots (data that arrived but was never accessed locally) over their sorted keys', () => {
    const a = new Y.Doc();
    a.getMap('stranger').set('b', 1);
    a.getMap('stranger').set('a', 2);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(summarizeDoc(b).shared.stranger).toStrictEqual({ kind: 'untyped', size: 2, digest: fnv1a('a|b') });
  });

  it('lists epoch-ms fields only (2001‥2286), at most eight, and only on object entries', () => {
    const doc = new Y.Doc();
    const m = doc.getMap('m');
    m.set('bounds', { low: 1e12, lowIn: 1e12 + 1, highIn: 1e13 - 1, high: 1e13, str: '1700000000000', neg: -1.7e12 });
    const many: Record<string, number> = {};
    for (let i = 0; i < 9; i++) many[`t${i}`] = 1_700_000_000_000 + i;
    m.set('many', many);
    m.set('arr', [1_700_000_000_000]);
    m.set('nil', null);
    m.set('num', 1_700_000_000_000);

    const entries = summarizeDoc(doc).shared.m.entries!;
    expect(entries.bounds.ts).toStrictEqual({ lowIn: 1e12 + 1, highIn: 1e13 - 1 });
    expect(Object.keys(entries.many.ts!)).toStrictEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']);
    expect(entries.arr).toStrictEqual({ h: fnv1a(stableStringify([1_700_000_000_000])) });
    expect(entries.nil).toStrictEqual({ h: fnv1a('null') });
    expect(entries.num).toStrictEqual({ h: fnv1a('1700000000000') });
  });

  it('caps the listed entries at 20000 per map while the digest still covers every key', () => {
    const doc = new Y.Doc();
    const big = doc.getMap('big');
    doc.transact(() => {
      for (let i = 0; i < 20_001; i++) big.set(`k${i}`, i);
    });

    const s = summarizeDoc(doc).shared.big;
    expect(s.size).toBe(20_001);
    expect(s.truncated).toBe(true);
    expect(Object.keys(s.entries!)).toHaveLength(20_000);
  });
});
