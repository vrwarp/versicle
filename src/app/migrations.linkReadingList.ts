/**
 * ════════════════════════════════════════════════════════════════════════
 *  ONE-TIME READING-LIST `bookId` LINKER — AUTHORED, **NOT REGISTERED**
 * ════════════════════════════════════════════════════════════════════════
 *
 * Phase 7 §D (phase7-library-google.md): `ReadingListEntry.bookId` is the FK
 * to the library inventory, written at registration time for every NEW
 * entry since the ImportOrchestrator cutover. EXISTING entries are linked by
 * this one-time doc transform: exact `sourceFilename` join first, then the
 * `generateMatchKey` fuzzy join (entity-resolution demoted from render-time
 * joiner to one-time linker).
 *
 * WHY IT IS NOT IN `CRDT_MIGRATIONS` YET (the sub-track's hard exclusion):
 * old clients rebuild whole entry objects on edit
 * (useReadingListStore.ts addEntry/upsertEntry spread fresh literals) and
 * would silently DROP the unknown `bookId` field — so the linker must ride
 * a CRDT VERSION BUMP that quarantines pre-bump clients. That bump is
 * serialized by master-plan rule 4 (one in-flight format change) BEHIND the
 * P6 chain's v7; it lands post-merge on main as the next step:
 *
 *     // src/app/migrations.ts — POST-MERGE registration (~20 lines):
 *     //   import { linkReadingListEntries } from './migrations.linkReadingList';
 *     //   export const CRDT_MIGRATIONS = [
 *     //     …existing steps…,
 *     //     { from: <current>, to: <current + 1>, migrate: linkReadingListEntries },
 *     //   ];
 *     // plus: captured-doc fixture (scripts/ capture, P2 pattern) + the
 *     // two-client quarantine E2E (rule 6) + renumbering note for the
 *     // husk-clear/dual-write retirement (README §5/P9).
 *
 * Transform discipline (the F.3 pattern from the v6 work): deterministic
 * (sorted iteration), idempotent (copy-if-absent), additive (no destructive
 * op) — hence LWW-safe under concurrent migration by multiple clients.
 */
import * as Y from 'yjs';
import { generateMatchKey } from '@lib/entity-resolution';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Link every reading-list entry lacking a `bookId` to its inventory item.
 * Pure doc transform — run it inside the coordinator's transaction when the
 * post-merge step registers it.
 */
export function linkReadingListEntries(doc: Y.Doc): void {
  const entriesRoot = doc.getMap('reading-list').get('entries');
  const booksRoot = doc.getMap('books').get('books');
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
