/**
 * useReaderController — contract gates over the controller's source.
 *
 * The controller stands up the whole reader stack (engine construction, the
 * session recorder, the worker-backed SearchSession, the GenAI embedding
 * indexer), so the invariants below are asserted the way the kernel-boundary
 * and worker-chunk checks assert theirs: against the tree, not a convention.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');
const CONTROLLER = readFileSync(join(SRC, 'app', 'reader', 'useReaderController.ts'), 'utf8');
const EPUB_READER = readFileSync(join(SRC, 'hooks', 'useEpubReader.ts'), 'utf8');
const BOOK_TYPES = readFileSync(join(SRC, 'types', 'book.ts'), 'utf8');

/** Every field `BookMetadata` (= Book & BookSource & BookState) carries. */
function bookMetadataFields(): Set<string> {
  const fields = new Set<string>();
  for (const name of ['Book', 'BookSource', 'BookState']) {
    const start = BOOK_TYPES.indexOf(`interface ${name} {`);
    expect(start, `interface ${name} is gone from types/book.ts`).toBeGreaterThan(-1);
    const end = BOOK_TYPES.indexOf('\n}', start);
    for (const m of BOOK_TYPES.slice(start, end).matchAll(/^ {2}(\w+)\??:/gm)) fields.add(m[1]);
  }
  return fields;
}

/**
 * The BookMetadata fields useEpubReader reads off the metadata it is HANDED.
 * `meta` and `next` are the options metadata; `metadata` and `prev` are the
 * state set from it — all four are the same object the controller passes in.
 */
function consumedMetadataFields(): Set<string> {
  const known = bookMetadataFields();
  const consumed = new Set<string>();
  const re = /(?:optionsRef\.current\.metadata|\bmetadata|\bmeta|\bnext|\bprev)\??\.([A-Za-z0-9_$]+)/g;
  for (const m of EPUB_READER.matchAll(re)) {
    if (known.has(m[1])) consumed.add(m[1]);
  }
  return consumed;
}

/** The keys the controller's narrowed `readerMetadata` memo actually writes. */
function narrowedMetadataKeys(): string[] {
  const start = CONTROLLER.indexOf('const readerMetadata = useMemo<BookMetadata | null>(');
  expect(start, 'the readerMetadata memo was renamed — update this gate').toBeGreaterThan(-1);
  const block = CONTROLLER.slice(start, CONTROLLER.indexOf('\n  );', start));
  return [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
}

/**
 * perf: the controller hands useEpubReader a NARROWED projection instead of
 * the live `useBook` join, whose identity moves on every progress write. The
 * narrowing is a hand-written object literal over hoisted primitives, and
 * every field useEpubReader consumes is OPTIONAL on BookMetadata — so the
 * narrowed object type-checks with any of them missing and a dropped field is
 * silent. `currentCfi` was dropped: useEpubReader uses it as the last-resort
 * start location (`optionsRef.current.initialLocation || meta?.currentCfi`),
 * which the app only ever reached because the controller also passes
 * `getInitialLocation` — remove that and the resume would land at page one.
 */
describe('regression: the narrowed reader metadata carries every field the engine consumes', () => {
  it('carries currentCfi — useEpubReader’s last-resort start location', () => {
    expect(EPUB_READER).toContain('meta?.currentCfi');
    expect(narrowedMetadataKeys()).toContain('currentCfi');
  });

  it('carries every BookMetadata field useEpubReader reads off the metadata it is handed', () => {
    const provided = new Set(narrowedMetadataKeys());
    const dropped = [...consumedMetadataFields()].filter((field) => !provided.has(field)).sort();

    expect(
      dropped,
      'useEpubReader reads these off the metadata it is handed, but the controller’s ' +
        'readerMetadata memo does not list them — they reach the engine as undefined',
    ).toEqual([]);
  });
});
