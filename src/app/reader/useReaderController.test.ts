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

/**
 * The recorder-lifecycle effect, sliced out of the controller source: from
 * the recorder's construction to the effect's dependency array.
 */
function recorderLifecycleEffect(): string {
  const start = CONTROLLER.indexOf('const recorder = new ReadingSessionRecorder({');
  expect(start, 'the recorder lifecycle effect was restructured — update this gate').toBeGreaterThan(
    -1,
  );
  const end = CONTROLLER.indexOf('}, [bookId, coldOpenGuard]);', start);
  expect(end, 'the recorder effect’s dependency array moved — update this gate').toBeGreaterThan(-1);
  return CONTROLLER.slice(start, end);
}

/** The source of the `{` … `}` (or `… ;`) that follows `at`. */
function bodyAt(source: string, at: number): string {
  if (source[at] !== '{') return source.slice(at, source.indexOf(';', at));
  let depth = 0;
  for (let i = at; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('unbalanced handler body');
}

/** Every zero-arg arrow const declared in `block`, by name. */
function arrowConsts(block: string): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const m of block.matchAll(/const (\w+)\s*=\s*\(\)\s*=>\s*/g)) {
    bodies.set(m[1], bodyAt(block, m.index + m[0].length));
  }
  return bodies;
}

/** One handler's body with its local zero-arg callees substituted in place. */
function inlinedHandler(name: string, bodies: Map<string, string>, depth = 0): string {
  const body = bodies.get(name);
  expect(body, `handler ${name} is not declared in the recorder effect`).toBeDefined();
  if (depth >= 4) return body!;
  return body!.replace(/\b(\w+)\(\)/g, (whole, callee: string) =>
    callee !== name && bodies.has(callee) ? inlinedHandler(callee, bodies, depth + 1) : whole,
  );
}

/**
 * durability regression: the recorder merges up to five seconds of
 * relocations into ONE CRDT write, so between windows the user's place exists
 * only in memory and these two events are what make it durable.
 * `recorder.flushPending()` alone does NOT make it durable: it writes the
 * merged commit into the CRDT store, which hands the bytes to y-idb, which
 * holds them for `writeDebounceMs` (200ms, src/store/yjs-provider.ts). y-idb's
 * own unload drain does not cover that write — the binding is constructed
 * during boot, so its listener is registered first and fires BEFORE this
 * handler, snapshotting a queue the merged commit has not been added to yet.
 * A background kill inside that 200ms therefore loses the whole window, which
 * the un-coalesced write-through path could not lose. The handler must end on
 * disk: flushPending() first, then flushYjsPersistence().
 */
describe('regression: backgrounding drains the recorder window all the way to disk', () => {
  it('imports the persistence drain from the store provider', () => {
    expect(CONTROLLER).toMatch(
      /import \{[^}]*\bflushYjsPersistence\b[^}]*\} from '@store\/yjs-provider';/,
    );
  });

  it('flushes the recorder AND then the y-idb queue on both backgrounding signals', () => {
    const effect = recorderLifecycleEffect();
    const bodies = arrowConsts(effect);
    const registered = new Map(
      [
        ...effect.matchAll(
          /(?:document|window)\.addEventListener\(\s*'(visibilitychange|pagehide)'\s*,\s*(\w+)\s*\)/g,
        ),
      ].map((m) => [m[1], m[2]] as const),
    );

    expect([...registered.keys()].sort()).toEqual(['pagehide', 'visibilitychange']);

    for (const [event, handler] of registered) {
      const body = inlinedHandler(handler, bodies);
      const recorderFlush = body.indexOf('recorder.flushPending()');
      const persistenceFlush = body.indexOf('flushYjsPersistence(');

      expect(recorderFlush, `${event} handler never issues the recorder's window`).toBeGreaterThan(
        -1,
      );
      expect(
        persistenceFlush,
        `${event} handler leaves the merged commit behind y-idb's 200ms write debounce — ` +
          'it must force the queue to disk with flushYjsPersistence()',
      ).toBeGreaterThan(-1);
      expect(
        recorderFlush,
        `${event} handler drains y-idb before the recorder window is even written`,
      ).toBeLessThan(persistenceFlush);
    }
  });
});
