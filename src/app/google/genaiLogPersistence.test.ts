/**
 * genaiLogPersistence suite: pins the cross-restart log contract — entries
 * appended via addLog survive a "restart" (module reset + re-init), Clear
 * Logs also clears the mirror, and the mirror prunes to maxLogs. Runs against
 * fake-indexeddb (test setup) with the REAL useGenAIStore.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGenAIStore } from '@store/useGenAIStore';
import type { GenAILogEntry } from '@domains/google';
import { closeGenaiLogsConnection, GENAI_LOGS_DB_NAME } from '@data/repos/genaiLogs';
import {
  initGenAILogPersistence,
  __flushGenAILogPersistenceForTests,
  __resetGenAILogPersistenceForTests,
} from './genaiLogPersistence';

const DB_NAME = GENAI_LOGS_DB_NAME;

function entry(id: string, timestamp: number): GenAILogEntry {
  return {
    id,
    timestamp,
    type: 'request',
    method: 'generateContent',
    payload: { prompt: `payload-${id}` },
  };
}

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onblocked = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Detach the mirror and release the DB connection (half of a "restart"). */
async function reset(): Promise<void> {
  __resetGenAILogPersistenceForTests();
  await closeGenaiLogsConnection();
}

/** Simulate an app restart: drop the in-memory buffer, re-wire the mirror. */
async function restart(): Promise<void> {
  await reset();
  useGenAIStore.setState({ logs: [] });
  await initGenAILogPersistence();
}

describe('genaiLogPersistence (cross-restart logs)', () => {
  beforeEach(async () => {
    await reset();
    await deleteDb();
    useGenAIStore.setState({ logs: [], maxLogs: 500 });
  });

  afterEach(async () => {
    await reset();
    await deleteDb();
    useGenAIStore.setState({ logs: [], maxLogs: 500 });
  });

  it('entries appended via addLog survive a restart (hydrated oldest→newest)', async () => {
    await initGenAILogPersistence();
    useGenAIStore.getState().addLog(entry('a', 1000));
    useGenAIStore.getState().addLog(entry('b', 2000));
    await __flushGenAILogPersistenceForTests();

    await restart();

    expect(useGenAIStore.getState().logs.map((l) => l.id)).toEqual(['a', 'b']);
    // The payloads round-trip intact (they are what Download Logs exports).
    expect(useGenAIStore.getState().logs[0].payload).toEqual({ prompt: 'payload-a' });
  });

  it('hydration PREPENDS restored entries under fresher same-session ones and dedupes by id', async () => {
    await initGenAILogPersistence();
    useGenAIStore.getState().addLog(entry('old', 1000));
    await __flushGenAILogPersistenceForTests();

    await reset();
    useGenAIStore.setState({ logs: [] });
    // A fresh session logs before hydration finishes.
    useGenAIStore.getState().addLog(entry('new', 3000));
    await initGenAILogPersistence();

    expect(useGenAIStore.getState().logs.map((l) => l.id)).toEqual(['old', 'new']);

    // Re-running init (idempotence) never duplicates entries.
    await initGenAILogPersistence();
    expect(useGenAIStore.getState().logs.map((l) => l.id)).toEqual(['old', 'new']);
  });

  it('clearLogs clears the persisted mirror too (nothing comes back after restart)', async () => {
    await initGenAILogPersistence();
    useGenAIStore.getState().addLog(entry('a', 1000));
    await __flushGenAILogPersistenceForTests();

    useGenAIStore.getState().clearLogs();
    await __flushGenAILogPersistenceForTests();

    await restart();
    expect(useGenAIStore.getState().logs).toHaveLength(0);
  });

  it('prunes the mirror to maxLogs (only the newest entries survive a restart)', async () => {
    useGenAIStore.setState({ maxLogs: 2 });
    await initGenAILogPersistence();
    useGenAIStore.getState().addLog(entry('a', 1000));
    useGenAIStore.getState().addLog(entry('b', 2000));
    useGenAIStore.getState().addLog(entry('c', 3000));
    await __flushGenAILogPersistenceForTests();

    await reset();
    useGenAIStore.setState({ logs: [], maxLogs: 2 });
    await initGenAILogPersistence();

    expect(useGenAIStore.getState().logs.map((l) => l.id)).toEqual(['b', 'c']);
  });
});
