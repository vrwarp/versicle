/**
 * ════════════════════════════════════════════════════════════════════════
 *  ONE-TIME READING-LIST `bookId` LINKER — CRDT MIGRATION v8
 * ════════════════════════════════════════════════════════════════════════
 *
 * Phase 7 §D (phase7-library-google.md): `ReadingListEntry.bookId` is the FK
 * to the library inventory, written at registration time for every NEW
 * entry since the ImportOrchestrator cutover. EXISTING entries are linked by
 * this one-time doc transform: exact `sourceFilename` join first, then the
 * `generateMatchKey` fuzzy join (entity-resolution demoted from render-time
 * joiner to one-time linker).
 *
 * Registered as `{ from: 7, to: 8 }` in src/app/migrations.ts — the rule-4
 * post-merge step behind the P6 chain's v7. The version bump is what makes
 * the FK safe: pre-v8 clients rebuild whole entry objects on edit
 * (useReadingListStore.ts addEntry/upsertEntry spread fresh literals) and
 * would silently DROP the unknown `bookId` field, so the standing
 * quarantine machinery (middleware pill + the P4 doc-level layers) locks
 * them out of a v8 workspace. Coverage: the F.3 fixture matrix (all eras →
 * v8, incl. the captured era-7 doc) + the F.2 v7-stack-vs-v8-doc
 * two-client case in src/store/__tests__/crdt-contract/migrations.test.ts.
 * Renumbering note: husk-clearing + `library.__schemaVersion` dual-write
 * retirement + activeContext husk pruning is v9 (P9).
 *
 * Transform discipline (the F.3 pattern from the v6 work): deterministic
 * (sorted iteration), idempotent (copy-if-absent), additive (no destructive
 * op) — hence LWW-safe under concurrent migration by multiple clients.
 */
import * as Y from 'yjs';
import { generateMatchKey } from '@lib/entity-resolution';

/**
 * String coercion for doc values. Pre-v4-era docs encode strings as Y.Text,
 * and nothing ever rewrites values in place (pure version bumps do not touch
 * data; the middleware repair path converts only keys a client locally
 * rewrites) — so a long-lived install can reach v7 with Y.Text titles,
 * authors and sourceFilenames. The join must read them like any string;
 * `toString()` on Y.Text is deterministic.
 */
const str = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Y.Text) return value.toString();
  return '';
};

/**
 * Link every reading-list entry lacking a `bookId` to its inventory item.
 * Pure doc transform — the coordinator runs it inside the v8 step's
 * transaction (atomic with the version bump).
 */
export function linkReadingListEntries(doc: Y.Doc): void {
  const entriesRoot = doc.getMap('reading-list').get('entries');
  // The inventory binds to Y.Map 'library', key 'books' (useBookStore
  // LIBRARY_STORE_DEF) — pinned by the F.3 captured-fixture matrix, which
  // caught this transform's original 'books'-map read as a latent no-op.
  const booksRoot = doc.getMap('library').get('books');
  if (!(entriesRoot instanceof Y.Map) || !(booksRoot instanceof Y.Map)) return;

  // Build the joins from the inventory — sorted iteration for determinism;
  // first writer wins on key collisions (stable across clients).
  const byFilename = new Map<string, string>();
  const byMatchKey = new Map<string, string>();
  for (const bookId of [...booksRoot.keys()].sort()) {
    const item = booksRoot.get(bookId);
    if (!(item instanceof Y.Map)) continue;
    const sourceFilename = str(item.get('sourceFilename'));
    if (sourceFilename && !byFilename.has(sourceFilename)) {
      byFilename.set(sourceFilename, bookId);
    }
    const matchKey = generateMatchKey(str(item.get('title')), str(item.get('author')));
    if (matchKey && !byMatchKey.has(matchKey)) {
      byMatchKey.set(matchKey, bookId);
    }
  }

  for (const filename of [...entriesRoot.keys()].sort()) {
    const entry = entriesRoot.get(filename);
    if (!(entry instanceof Y.Map)) continue;
    if (entry.get('bookId') !== undefined) continue; // copy-if-absent (idempotent, LWW-safe)

    let bookId = byFilename.get(filename);
    if (!bookId) {
      const matchKey = generateMatchKey(str(entry.get('title')), str(entry.get('author')));
      if (matchKey) bookId = byMatchKey.get(matchKey);
    }
    if (bookId) entry.set('bookId', bookId);
  }
}
