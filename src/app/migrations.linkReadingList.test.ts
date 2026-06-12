/**
 * One-time bookId linker pins (Phase 7 §D — the F.3 discipline: determinism,
 * idempotency, convergence under concurrent migration). The step is
 * REGISTERED as CRDT v8 ({ from: 7, to: 8 } in src/app/migrations.ts);
 * coordinator-level coverage (captured era fixtures → v8, two-client
 * v7-vs-v8 quarantine) lives in
 * src/store/__tests__/crdt-contract/migrations.test.ts — this suite pins
 * the transform's join semantics in isolation.
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
  // The real inventory address: Y.Map 'library', key 'books' (useBookStore).
  doc.getMap('library').set('books', books);
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

  it('joins through Y.Text values (pre-v4-era string encoding survives pure bumps)', () => {
    // A long-lived install can reach v7 with Y.Text titles/authors/
    // sourceFilenames: pure version bumps never rewrote values, and the
    // middleware repair path converts only locally-rewritten keys.
    const doc = new Y.Doc();
    const books = new Y.Map();
    doc.getMap('library').set('books', books);
    const book = new Y.Map();
    books.set('id-ytext', book);
    book.set('bookId', new Y.Text('id-ytext'));
    book.set('title', new Y.Text('Moby Dick'));
    book.set('author', new Y.Text('Melville'));
    book.set('sourceFilename', new Y.Text('moby.epub'));

    const entries = new Y.Map();
    doc.getMap('reading-list').set('entries', entries);
    const exact = new Y.Map();
    exact.set('filename', new Y.Text('moby.epub'));
    exact.set('title', new Y.Text('Different'));
    entries.set('moby.epub', exact);
    const fuzzy = new Y.Map();
    fuzzy.set('filename', new Y.Text('moby_dick.epub'));
    fuzzy.set('title', new Y.Text('Moby_Dick'));
    fuzzy.set('author', new Y.Text('Melville'));
    entries.set('moby_dick.epub', fuzzy);

    linkReadingListEntries(doc);

    expect(entryBookId(doc, 'moby.epub')).toBe('id-ytext'); // exact, via Y.Text sourceFilename
    expect(entryBookId(doc, 'moby_dick.epub')).toBe('id-ytext'); // fuzzy, via Y.Text title/author
  });
});
