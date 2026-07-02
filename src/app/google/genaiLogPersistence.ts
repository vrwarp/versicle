/**
 * GenAI activity-log persistence wiring: mirrors the store's in-memory log
 * ring buffer into the `versicle-genai-logs` side database (the data-layer
 * {@link genaiLogsRepo}) so the logs survive app restarts — the
 * in-memory-only buffer kept losing them on every reload.
 *
 * This module is the app-layer seam (README §2 rule 3): the store never
 * touches IDB and the repo never touches the store; the composition root
 * wires the two here via {@link initGenAILogPersistence} (called once from
 * wireGoogle):
 *
 *  1. hydrate — load the persisted entries and PREPEND them into the store
 *     (deduped by id, capped at maxLogs) via `hydrateLogs`;
 *  2. mirror — subscribe to the store and write-through every appended entry
 *     (all producers funnel through addLog: the GenAI/embedding clients AND
 *     the TTS worker bridge), prune to maxLogs, and clear the DB when the
 *     user clears the buffer.
 *
 * The repo is fail-soft and serializes its own writes, so a persistence
 * failure (private browsing, quota) never breaks logging itself — the
 * in-memory buffer keeps working exactly as before. Entries arrive
 * PRE-REDACTED from the clients (domains/google/genai/logging.ts), so no
 * inlineData/base64 image bytes are ever persisted.
 */
import type { GenAILogEntry } from '@domains/google';
import { genaiLogsRepo } from '@data/repos/genaiLogs';
import { useGenAIStore } from '@store/useGenAIStore';

let initialized = false;
let unsubscribe: (() => void) | null = null;

/**
 * Hydrate the store's log buffer from the side DB, then mirror every buffer
 * change back into it. Idempotent; called once from wireGoogle. Returns the
 * hydration promise (awaited by tests; fire-and-forget in production).
 */
export function initGenAILogPersistence(): Promise<void> {
  if (initialized) return Promise.resolve();
  initialized = true;

  // `knownIds` tracks which entry ids are already in the DB, so the mirror
  // only writes genuinely new entries (ring-buffer trimming shortens the
  // array from the front — those entries stay persisted until pruned) and
  // never re-writes the rows hydration itself just loaded.
  const knownIds = new Set<string>();

  // Persist anything logged BEFORE this init ran (early-boot entries) — the
  // subscription below only sees future changes.
  const initial = useGenAIStore.getState();
  for (const entry of initial.logs) {
    knownIds.add(entry.id);
    genaiLogsRepo.append(entry, initial.maxLogs);
  }

  let prevLogs = initial.logs;
  unsubscribe = useGenAIStore.subscribe((state) => {
    const logs = state.logs;
    if (logs === prevLogs) return; // unrelated state change
    const hadLogs = prevLogs.length > 0;
    prevLogs = logs;

    if (logs.length === 0) {
      if (hadLogs) {
        knownIds.clear();
        genaiLogsRepo.clear();
      }
      return;
    }
    for (const entry of logs) {
      if (knownIds.has(entry.id)) continue;
      knownIds.add(entry.id);
      genaiLogsRepo.append(entry, state.maxLogs);
    }
  });

  return genaiLogsRepo
    .loadRecent(useGenAIStore.getState().maxLogs)
    .then((entries) => {
      if (entries.length === 0) return;
      for (const entry of entries) knownIds.add(entry.id);
      // The persisted row shape is structurally identical to GenAILogEntry
      // (the repo restates it because the data layer imports no domain
      // modules); the rows round-trip losslessly.
      useGenAIStore.getState().hydrateLogs(entries as GenAILogEntry[]);
    });
}

/** TEST-ONLY: await every persistence op enqueued so far. */
export function __flushGenAILogPersistenceForTests(): Promise<void> {
  return genaiLogsRepo.flush();
}

/**
 * TEST-ONLY: detach the mirror so each test can delete the database (via
 * `closeGenaiLogsConnection`) and wire a fresh mirror, simulating a restart.
 */
export function __resetGenAILogPersistenceForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  initialized = false;
}
