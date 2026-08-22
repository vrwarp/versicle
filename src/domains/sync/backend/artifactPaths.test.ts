/**
 * The shared-artifact path helper and the OBSERVE-mode metadata validator —
 * both live in SyncBackend.ts alongside the port declaration.
 *
 * `artifactHeadTail` is the reason a head record and its blob can be found
 * from one another; OBSERVE mode is deliberately non-enforcing, and that
 * pass-through is the property worth pinning (a future flip to enforcement
 * should break these, loudly).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkspaceMetadata } from '~types/workspace';
import { artifactHeadTail, observeWorkspaceMetadata } from './SyncBackend';

let warnLogs: unknown[][];

beforeEach(() => {
  warnLogs = [];
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => warnLogs.push(a));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('artifactHeadTail', () => {
  it('maps a blob tail to its sibling head record', () => {
    expect(artifactHeadTail('embeddings/abc123.bin')).toBe('embedCache/abc123');
  });

  it('strips the prefix only at the START', () => {
    expect(artifactHeadTail('embeddings/nested/embeddings/k.bin')).toBe(
      'embedCache/nested/embeddings/k'
    );
  });

  it('strips the extension only at the END', () => {
    expect(artifactHeadTail('embeddings/a.bin.b.bin')).toBe('embedCache/a.bin.b');
  });

  it('leaves a key with no prefix or extension alone', () => {
    expect(artifactHeadTail('plainkey')).toBe('embedCache/plainkey');
  });

  it('keeps a `.bin` that is not the extension', () => {
    expect(artifactHeadTail('embeddings/a.binary')).toBe('embedCache/a.binary');
  });

  it('is stable — the same blob path always names the same head', () => {
    expect(artifactHeadTail('embeddings/k.bin')).toBe(artifactHeadTail('embeddings/k.bin'));
  });
});

describe('observeWorkspaceMetadata', () => {
  const valid = (over: Partial<WorkspaceMetadata> = {}): WorkspaceMetadata => ({
    workspaceId: 'ws_1',
    name: 'Library',
    createdAt: 1,
    schemaVersion: 6,
    ...over,
  });

  it('returns the rows untouched and says nothing when they all validate', () => {
    const rows = [valid(), valid({ workspaceId: 'ws_2', deletedAt: 9 })];

    expect(observeWorkspaceMetadata(rows, 'list')).toBe(rows);
    expect(warnLogs).toEqual([]);
  });

  it('PASSES THROUGH a bad row rather than rejecting it (OBSERVE mode)', () => {
    const bad = { workspaceId: 'ws_bad' } as WorkspaceMetadata;
    const rows = [bad];

    expect(observeWorkspaceMetadata(rows, 'list')).toBe(rows);
    expect(rows[0]).toBe(bad);
  });

  it('logs the source and the offending workspace id under the search key', () => {
    observeWorkspaceMetadata([{ workspaceId: 'ws_bad' } as WorkspaceMetadata], 'listWorkspaces');

    const line = warnLogs.map((a) => a.map(String).join(' ')).join('\n');
    expect(line).toContain('workspace-metadata-observe');
    expect(line).toContain('source=listWorkspaces');
    expect(line).toContain('workspaceId=ws_bad');
    expect(line).toContain('OBSERVE mode: row passed through unmodified');
  });

  it('reports a row that is not even an object without crashing', () => {
    expect(() => observeWorkspaceMetadata([null as unknown as WorkspaceMetadata], 'x')).not.toThrow();
    expect(warnLogs.map((a) => a.map(String).join(' ')).join('\n')).toContain(
      'workspaceId=undefined'
    );
  });

  it('warns once PER bad row, and not for the good ones beside them', () => {
    observeWorkspaceMetadata(
      [valid(), { workspaceId: 'a' } as WorkspaceMetadata, { workspaceId: 'b' } as WorkspaceMetadata],
      'x'
    );

    expect(warnLogs).toHaveLength(2);
  });

  it('carries the schema issues alongside the message', () => {
    observeWorkspaceMetadata([{ workspaceId: 'ws_bad' } as WorkspaceMetadata], 'x');

    expect(warnLogs[0][warnLogs[0].length - 1]).toEqual(expect.any(Array));
  });

  it('handles an empty batch', () => {
    expect(observeWorkspaceMetadata([], 'x')).toEqual([]);
  });
});
