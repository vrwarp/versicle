/**
 * `MigrationStateService` — the state-machine transitions.
 *
 * MigrationStateService.test.ts covers the read/write round trip. This
 * file pins the transitions' carry-forward rule: `previousWorkspaceId` is
 * what a rollback uses to put the user back where they were, so every
 * transition that can see one must carry it, and one that cannot must not
 * invent the key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MigrationStateService } from './MigrationStateService';

const STORAGE_KEY = '__VERSICLE_MIGRATION_STATE__';

let infoLogs: string[];
let warnLogs: string[];
let errorLogs: string[];

beforeEach(() => {
  localStorage.clear();
  infoLogs = [];
  warnLogs = [];
  errorLogs = [];
  vi.spyOn(console, 'info').mockImplementation((...a: unknown[]) => infoLogs.push(a.map(String).join(' ')));
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => warnLogs.push(a.map(String).join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => errorLogs.push(a.map(String).join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('MigrationStateService.getState', () => {
  it('is null when nothing is stored', () => {
    expect(MigrationStateService.getState()).toBeNull();
  });

  it('is null for an EMPTY stored value rather than parsing it', () => {
    localStorage.setItem(STORAGE_KEY, '');

    expect(MigrationStateService.getState()).toBeNull();
    // Empty short-circuits before the parse, so nothing is logged.
    expect(warnLogs).toEqual([]);
  });

  it('rejects a stored object with no status', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ targetWorkspaceId: 'ws_1' }));

    expect(MigrationStateService.getState()).toBeNull();
  });

  it('CLEARS and warns on unparseable JSON, so the next boot is clean', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');

    expect(MigrationStateService.getState()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(warnLogs.some((l) => l.includes('Failed to parse migration state, clearing'))).toBe(
      true
    );
  });
});

describe('MigrationStateService.setState / clear', () => {
  it('round-trips a state and names the status in the log', () => {
    MigrationStateService.setState({
      status: 'STAGED',
      targetWorkspaceId: 'ws_1',
      backupCheckpointId: 3,
    });

    expect(MigrationStateService.getState()).toEqual({
      status: 'STAGED',
      targetWorkspaceId: 'ws_1',
      backupCheckpointId: 3,
    });
    expect(infoLogs.some((l) => l.includes('Setting migration state: STAGED'))).toBe(true);
    expect(infoLogs.some((l) => l.includes('[MigrationState]'))).toBe(true);
  });

  it('clear removes the entry and says so', () => {
    MigrationStateService.setState({
      status: 'STAGED',
      targetWorkspaceId: 'ws_1',
      backupCheckpointId: 1,
    });

    MigrationStateService.clear();

    expect(MigrationStateService.getState()).toBeNull();
    expect(infoLogs.some((l) => l.includes('Clearing migration state'))).toBe(true);
  });
});

describe('MigrationStateService.setStaged', () => {
  it('records the target, the backup and the workspace being left', () => {
    MigrationStateService.setStaged('ws_target', 7, 'ws_before');

    expect(MigrationStateService.getState()).toEqual({
      status: 'STAGED',
      targetWorkspaceId: 'ws_target',
      backupCheckpointId: 7,
      previousWorkspaceId: 'ws_before',
    });
  });

  it('OMITS the previous-workspace key when there was none', () => {
    MigrationStateService.setStaged('ws_target', 7);

    expect(MigrationStateService.getState()).toEqual({
      status: 'STAGED',
      targetWorkspaceId: 'ws_target',
      backupCheckpointId: 7,
    });
    expect(MigrationStateService.getState()).not.toHaveProperty('previousWorkspaceId');
  });
});

describe('MigrationStateService.setAwaitingConfirmation', () => {
  it('CARRIES the previous workspace forward from the STAGED state', () => {
    MigrationStateService.setStaged('ws_target', 7, 'ws_before');

    MigrationStateService.setAwaitingConfirmation('ws_target', 7);

    expect(MigrationStateService.getState()).toEqual({
      status: 'AWAITING_CONFIRMATION',
      targetWorkspaceId: 'ws_target',
      backupCheckpointId: 7,
      previousWorkspaceId: 'ws_before',
    });
  });

  it('omits the key when the prior state carried none', () => {
    MigrationStateService.setStaged('ws_target', 7);

    MigrationStateService.setAwaitingConfirmation('ws_target', 7);

    expect(MigrationStateService.getState()).not.toHaveProperty('previousWorkspaceId');
  });

  it('works from NO prior state at all', () => {
    MigrationStateService.setAwaitingConfirmation('ws_target', 9);

    expect(MigrationStateService.getState()).toEqual({
      status: 'AWAITING_CONFIRMATION',
      targetWorkspaceId: 'ws_target',
      backupCheckpointId: 9,
    });
  });
});

describe('MigrationStateService.setRestoringBackup', () => {
  it('refuses — loudly — when there is no state to roll back from', () => {
    MigrationStateService.setRestoringBackup();

    expect(MigrationStateService.getState()).toBeNull();
    expect(
      errorLogs.some((l) => l.includes('Cannot transition to RESTORING_BACKUP: no current state'))
    ).toBe(true);
  });

  it('preserves the target, backup and previous workspace of the state it replaces', () => {
    MigrationStateService.setStaged('ws_target', 7, 'ws_before');

    MigrationStateService.setRestoringBackup();

    expect(MigrationStateService.getState()).toEqual({
      status: 'RESTORING_BACKUP',
      targetWorkspaceId: 'ws_target',
      backupCheckpointId: 7,
      previousWorkspaceId: 'ws_before',
    });
  });

  it('omits the previous-workspace key when the prior state had none', () => {
    MigrationStateService.setStaged('ws_target', 7);

    MigrationStateService.setRestoringBackup();

    expect(MigrationStateService.getState()).not.toHaveProperty('previousWorkspaceId');
  });
});
