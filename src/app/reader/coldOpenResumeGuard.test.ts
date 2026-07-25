/**
 * ColdOpenResumeGuard — the owning suite for the cold-open resume race fix.
 *
 * The guard's job: when the reader opened without a saved CFI, no recorder
 * write may reach the store until the Yjs IDB load has settled, and the
 * first post-settle relocation reconciles ONCE — re-display to a valid
 * saved position (mislanding), or disarm and let writes flow (genuinely
 * new book / import-percentage-only / deliberate navigation).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ColdOpenResumeGuard, type ColdOpenResumeGuardDeps } from './coldOpenResumeGuard';
import type { UserProgress } from '~types/user-data';

const savedAt = (percentage: number, currentCfi?: string): UserProgress => ({
  bookId: 'book-1',
  percentage,
  currentCfi,
  lastRead: 1000,
  completedRanges: [],
});

function makeGuard(overrides: Partial<ColdOpenResumeGuardDeps> = {}) {
  const deps = {
    isSyncSettled: vi.fn<() => boolean>(() => true),
    getSavedProgress: vi.fn<() => UserProgress | null>(() => null),
    display: vi.fn<(cfi: string) => Promise<void>>(() => Promise.resolve()),
    onRestored: vi.fn<() => void>(),
    ...overrides,
  };
  return { guard: new ColdOpenResumeGuard(deps), deps };
}

describe('ColdOpenResumeGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays idle on a warm open (a location was resolved)', () => {
    const { guard, deps } = makeGuard({
      // Even a tempting saved position must not trigger anything on a warm open.
      getSavedProgress: () => savedAt(0.24, 'epubcfi(/6/8!/4/2/1:0)'),
    });
    guard.noteResolvedInitialLocation('epubcfi(/6/8!/4/2/1:0)');

    expect(guard.writesBlocked).toBe(false);
    expect(guard.onRelocated(0.0)).toBe('pass');
    expect(deps.display).not.toHaveBeenCalled();
  });

  it('blocks writes while cold and un-settled, without consuming the one-shot', () => {
    const { guard, deps } = makeGuard({ isSyncSettled: () => false });
    guard.noteResolvedInitialLocation(undefined);

    expect(guard.writesBlocked).toBe(true);
    expect(guard.onRelocated(0.0)).toBe('blocked');
    // Repeated relocations while un-settled keep blocking (page turns at
    // the mislanded start must not commit).
    expect(guard.onRelocated(0.001)).toBe('blocked');
    expect(guard.writesBlocked).toBe(true);
    expect(deps.display).not.toHaveBeenCalled();
  });

  it('restores to a valid saved CFI on the first settled relocation at the start', () => {
    const { guard, deps } = makeGuard({
      getSavedProgress: () => savedAt(0.24, 'epubcfi(/6/8!/4/2/1:0)'),
    });
    guard.noteResolvedInitialLocation(undefined);

    expect(guard.onRelocated(0.0)).toBe('restored');
    expect(deps.display).toHaveBeenCalledWith('epubcfi(/6/8!/4/2/1:0)');
    expect(deps.onRestored).toHaveBeenCalledTimes(1);
    // Disarmed: the re-display's own relocation records normally.
    expect(guard.writesBlocked).toBe(false);
    expect(guard.onRelocated(0.24)).toBe('pass');
    expect(deps.display).toHaveBeenCalledTimes(1);
  });

  it('restores when settle arrives only after blocked relocations', () => {
    let settled = false;
    const { guard, deps } = makeGuard({
      isSyncSettled: () => settled,
      getSavedProgress: () => savedAt(0.24, 'epubcfi(/6/8!/4/2/1:0)'),
    });
    guard.noteResolvedInitialLocation(undefined);

    expect(guard.onRelocated(0.0)).toBe('blocked');
    settled = true;
    expect(guard.onRelocated(0.002)).toBe('restored');
    expect(deps.display).toHaveBeenCalledWith('epubcfi(/6/8!/4/2/1:0)');
  });

  it('passes (and disarms) for a genuinely new book', () => {
    const { guard, deps } = makeGuard({ getSavedProgress: () => null });
    guard.noteResolvedInitialLocation(undefined);

    expect(guard.onRelocated(0.0)).toBe('pass');
    expect(guard.writesBlocked).toBe(false);
    expect(deps.display).not.toHaveBeenCalled();
    expect(deps.onRestored).not.toHaveBeenCalled();
  });

  it('passes for import-with-percentage-only (no CFI) — the ImportJumpPrompt owns that flow', () => {
    const { guard, deps } = makeGuard({
      // The reading-list import path writes percentage with an empty CFI.
      getSavedProgress: () => savedAt(0.24, ''),
    });
    guard.noteResolvedInitialLocation(undefined);

    expect(guard.onRelocated(0.0)).toBe('pass');
    expect(deps.display).not.toHaveBeenCalled();
  });

  it('passes for a below-validity-floor saved position', () => {
    const { guard, deps } = makeGuard({
      // 0.4% saved: below the isValidProgress floor — not worth a yank.
      getSavedProgress: () => savedAt(0.004, 'epubcfi(/6/2!/4/2/1:0)'),
    });
    guard.noteResolvedInitialLocation(undefined);

    expect(guard.onRelocated(0.0)).toBe('pass');
    expect(deps.display).not.toHaveBeenCalled();
  });

  it('lets a deliberate navigation win: no restore when the reader is past the start', () => {
    const { guard, deps } = makeGuard({
      getSavedProgress: () => savedAt(0.24, 'epubcfi(/6/8!/4/2/1:0)'),
    });
    guard.noteResolvedInitialLocation(undefined);

    // The user jumped (TOC, search) to 50% before the first guarded check.
    expect(guard.onRelocated(0.5)).toBe('pass');
    expect(deps.display).not.toHaveBeenCalled();
    // One-shot consumed — later relocations at the start don't yank either.
    expect(guard.onRelocated(0.0)).toBe('pass');
  });

  it('reports restored (and disarms) even when the display promise rejects', async () => {
    const rejection = Promise.reject(new Error('stale CFI'));
    const { guard } = makeGuard({
      getSavedProgress: () => savedAt(0.24, 'epubcfi(/6/8!/4/2/1:0)'),
      display: () => rejection,
    });
    guard.noteResolvedInitialLocation(undefined);

    expect(guard.onRelocated(0.0)).toBe('restored');
    expect(guard.writesBlocked).toBe(false);
    // The rejection is swallowed (logged) — no unhandled rejection.
    await rejection.catch(() => undefined);
  });

  it('re-latches per open via noteResolvedInitialLocation', () => {
    const { guard } = makeGuard();
    guard.noteResolvedInitialLocation(undefined);
    expect(guard.writesBlocked).toBe(true);

    // Next open resolves a location: guard idles again.
    guard.noteResolvedInitialLocation('epubcfi(/6/8!/4/2/1:0)');
    expect(guard.writesBlocked).toBe(false);
    expect(guard.onRelocated(0.0)).toBe('pass');
  });
});
