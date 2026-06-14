import { describe, it, expect } from 'vitest';
import { getChanges } from '../../src/diff';
import { ChangeType } from '../../src/types';

/**
 * Fork contract suite — current diff behavior (phase2-fork-surgery.md §3
 * cases A.5-unit and A.11).
 *
 * These pin the EXACT change lists the differ emits today so that any future
 * diff rewrite (scoped diffing lands in Phase 2 surgery 3) is a conscious
 * contract change, not an accident.
 */

describe('contract A.5 (unit) — record diff emits DELETE for keys absent from the new state', () => {
  it('emits DELETE for data keys, never for functions (the D2 hydration-wipe primitive)', () => {
    const action = () => undefined;
    const changes = getChanges({ gone: 1, kept: 2, action }, { kept: 2 });
    expect(changes).toEqual([[ChangeType.DELETE, 'gone', undefined]]);
  });

  it('emits INSERT / UPDATE / PENDING for added, replaced, and nested-changed keys', () => {
    const changes = getChanges(
      { same: 1, replaced: 'a', nested: { x: 1, y: 2 } },
      { same: 1, replaced: 'b', nested: { x: 1, y: 3 }, added: true },
    );
    expect(changes).toContainEqual([ChangeType.INSERT, 'added', true]);
    expect(changes).toContainEqual([
      ChangeType.PENDING,
      'nested',
      [[ChangeType.UPDATE, 'y', 3]],
    ]);
    // 'replaced' is a string pair → string-level diff rides in a PENDING.
    expect(
      changes.find(([type, key]) => key === 'replaced' && type === ChangeType.PENDING),
    ).toBeDefined();
    expect(changes.find(([, key]) => key === 'same')).toBeUndefined();
  });
});

describe('contract A.11 — array diff semantics', () => {
  it('mid-array insert is detected via the lookahead window', () => {
    expect(getChanges([1, 2, 3], [1, 99, 2, 3])).toEqual([
      [ChangeType.INSERT, 1, 99],
    ]);
  });

  it('mid-array delete is detected via the lookahead window', () => {
    expect(getChanges([1, 2, 3], [1, 3])).toEqual([
      [ChangeType.DELETE, 1, undefined],
    ]);
  });

  it('mid-array scalar replacement is an UPDATE', () => {
    expect(getChanges([1, 2, 3], [1, 5, 3])).toEqual([[ChangeType.UPDATE, 1, 5]]);
  });

  it('nested records in arrays diff recursively (PENDING)', () => {
    expect(getChanges([{ id: 1, v: 1 }], [{ id: 1, v: 2 }])).toEqual([
      [ChangeType.PENDING, 0, [[ChangeType.UPDATE, 'v', 2]]],
    ]);
  });

  it('PINNED DEGENERATION: displacement beyond the 10-item lookahead window degrades to element-wise UPDATE + tail INSERT', () => {
    // 12 new items pushed in front of 5 existing ones: every original item is
    // displaced by 12 > LOOKAHEAD_WINDOW(10), so the differ finds no match
    // and rewrites the array element-wise: 5 UPDATEs + 12 tail INSERTs (17
    // changes), instead of the minimal 12 INSERTs. CONVERGENT but not
    // minimal — for Y.Array this discards CRDT identity of the displaced
    // items. A diff rewrite that improves this must change this test
    // deliberately (and re-run the two-doc fuzz equivalence suite).
    const original = [0, 1, 2, 3, 4];
    const inserted = Array.from({ length: 12 }, (_, i) => 100 + i);
    const next = [...inserted, ...original];

    const changes = getChanges(original, next);
    expect(changes).toHaveLength(17);
    expect(changes.slice(0, 5)).toEqual(
      original.map((_, i) => [ChangeType.UPDATE, i, next[i]]),
    );
    expect(changes.slice(5).every(([type]) => type === ChangeType.INSERT)).toBe(true);
    // Sanity: applying b-oriented semantics converges (tail covers the rest).
    expect(changes.slice(5).map(([, index]) => index)).toEqual(
      Array.from({ length: 12 }, (_, i) => 5 + i),
    );
  });
});
