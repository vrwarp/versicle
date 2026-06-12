/**
 * One-time bookId linker pins (Phase 7 §D — the F.3 discipline: determinism,
 * idempotency, convergence under concurrent migration). The step is authored
 * but NOT registered; the post-merge registration extends CRDT_MIGRATIONS
 * and adds the captured-doc fixture + two-client quarantine E2E.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { linkReadingListEntries } from './migrations.linkReadingList';

function plainToY(value: unknown): unknown {
  if (Array.isArray(value)) {
    const arr = new Y.Array();
    arr.push(value.map(plainToY));
    return arr;
  }
  if (value !== null && typeof value === 'object') {
    const map = new Y.Map();
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      map.set(key, plainToY(child));
    }
    return map;
  }
  return value;
}

function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  const books = new Y.Map();
  doc.getMap('books').set('books', books);
  books.set(
    'id-exact',
    plainToY({ bookId: 'id-exact', title: 'Exact Match', author: 'A', sourceFilename: 'exact.epub' }),
  );
  books.set(
    'id-fuzzy',
    plainToY({ bookId: 'id-fuzzy', title: 'Moby Dick', author: 'Melville', sourceFilename: 'renamed-on-disk.epub' }),
  );
  books.set(
    'id-unrelated',
    plainToY({ bookId: 'id-unrelated', title: 'Other', author: 'B', sourceFilename: 'other.epub' }),
  );

  const entries = new Y.Map();
  doc.getMap('reading-list').set('entries', entries);
  entries.set('exact.epub', plainToY({ filename: 'exact.epub', title: 'Different Title', author: 'X', percentage: 0.1, lastUpdated: 1 }));
  entries.set('moby_dick.epub', plainToY({ filename: 'moby_dick.epub', title: 'Moby_Dick', author: 'Melville', percentage: 0.2, lastUpdated: 1 }));
  entries.set('already.epub', plainToY({ filename: 'already.epub', title: 'Whatever', author: 'Y', percentage: 0.3, lastUpdated: 1, bookId: 'preexisting' }));
  entries.set('orphan.epub', plainToY({ filename: 'orphan.epub', title: 'No Match At All', author: 'Z', percentage: 0.4, lastUpdated: 1 }));
  return doc;
}

const entryBookId = (doc: Y.Doc, filename: string): unknown =>
  (doc.getMap('reading-list').get('entries') as Y.Map<Y.Map<unknown>>).get(filename)?.get('bookId');

describe('linkReadingListEntries', () => {
  it('links by exact sourceFilename, then fuzzy title+author; leaves orphans and existing FKs alone', () => {
    const doc = buildDoc();
    linkReadingListEntries(doc);

    expect(entryBookId(doc, 'exact.epub')).toBe('id-exact');
    expect(entryBookId(doc, 'moby_dick.epub')).toBe('id-fuzzy'); // underscore-normalized fuzzy join
    expect(entryBookId(doc, 'already.epub')).toBe('preexisting'); // copy-if-absent
    expect(entryBookId(doc, 'orphan.epub')).toBeUndefined();
  });

  it('is idempotent (second run is a no-op)', () => {
    const doc = buildDoc();
    linkReadingListEntries(doc);
    const after = JSON.stringify(doc.getMap('reading-list').toJSON());
    linkReadingListEntries(doc);
    expect(JSON.stringify(doc.getMap('reading-list').toJSON())).toBe(after);
  });

  it('converges under concurrent migration on two replicas (LWW-safe additive transform)', () => {
    const a = buildDoc();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Both replicas migrate independently…
    linkReadingListEntries(a);
    linkReadingListEntries(b);

    // …then merge in both directions: identical terminal state.
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(a.getMap('reading-list').toJSON()).toEqual(b.getMap('reading-list').toJSON());
    expect(entryBookId(a, 'exact.epub')).toBe('id-exact');
    expect(entryBookId(b, 'moby_dick.epub')).toBe('id-fuzzy');
  });

  it('tolerates docs without the maps (fresh installs, quarantined husks)', () => {
    const doc = new Y.Doc();
    expect(() => linkReadingListEntries(doc)).not.toThrow();
  });
});
