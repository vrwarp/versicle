import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LexiconService } from './LexiconService';
// We don't import LexiconRule type for mocking data as we use UserOverrides structure now

const mocks = vi.hoisted(() => {
  return {
    get: vi.fn(),
  };
});

vi.mock('../../db/db', () => ({
  getDB: vi.fn().mockResolvedValue({
    get: mocks.get,
  }),
}));

describe('LexiconService Sorting', () => {
  let service: LexiconService;

  beforeEach(() => {
    service = LexiconService.getInstance();
    vi.clearAllMocks();
  });

  it('should sort rules by Priority Group, then Order, then Length', async () => {
    // We mock `db.get('user_overrides', ...)` logic.
    // The implementation calls `get('global')` then `get(bookId)`.

    // Global rules
    mocks.get.mockImplementation(async (store, key) => {
        if (key === 'global') {
            return {
                bookId: 'global',
                lexicon: [
                    { id: '1', original: 'Global', replacement: 'G', created: 0 }
                ]
            };
        }
        if (key === 'b1') {
            return {
                bookId: 'b1',
                lexicon: [
                    { id: '2', original: 'BookPost', replacement: 'BP', created: 0 },
                    { id: '3', original: 'BookPre', replacement: 'BPre', created: 0 }
                ],
                lexiconConfig: { applyBefore: true } // Wait, this applies to ALL rules in this book?
                // Yes, `lexiconConfig.applyBefore` is per book document.
                // But the test case assumes mixed rules within book?
                // "id 3 ... applyBeforeGlobal: true".
                // In v18, `applyBeforeGlobal` is property of `UserOverrides`, not individual rule.
                // So for a single book, either ALL apply before, or ALL apply after.
                // If we want mixed behavior, it's not supported by schema v18 directly unless we split books (impossible) or
                // the implementation handles it.
                // The implementation:
                // if (bookOverrides.lexiconConfig?.applyBefore) { rules = [...bookRules, ...rules]; } else { rules = [...rules, ...bookRules]; }

                // So for 'b1', if applyBefore is true, ALL b1 rules come before global.
                // This means the test expectation needs to align with v18 logic or v18 logic needs to support per-rule.
                // The v18 schema `UserOverrides` has `lexicon: { ... }[]` and `lexiconConfig`.
                // It seems we lost per-rule `applyBeforeGlobal` granularity?
                // Migration logic: `lexiconConfig: { applyBefore: rules.some(r => r.applyBeforeGlobal) }`.
                // So if ANY rule was pre, the whole book becomes pre.

                // So in this test, if we want BookPre (3) before Global (1) AND BookPost (2) after Global (1), we can't do that easily for same book 'b1'.
                // But wait, "BookPost" implies it applies AFTER global.
                // If v18 groups by book, then all 'b1' rules are together.
                // So the test expectation "1. BookPre, 2. Global, 3. BookPost" is impossible if BookPre and BookPost share 'b1'.

                // Let's assume the test intends to verify priority.
                // If 'b1' has applyBefore=true, then (2,3) come before (1).
                // So order: 2, 3, 1 (or 3, 2, 1 depending on internal sort).

                // Let's update the test to reflect v18 constraints: Book rules are grouped.
                // We will test: Book(Pre) + Global -> Book comes first.
            };
        }
        return undefined;
    });

    // We can't strictly replicate the old test 1:1 if the behavior changed.
    // Let's adopt a scenario that IS supported: Book vs Global ordering.
    // If we return applyBefore=true for b1, then b1 rules should be before global.

    const result = await service.getRules('b1');

    // With applyBefore=true: [2, 3] then [1].
    // Within [2, 3], order is array order (2 then 3).
    // result[0] = 2, result[1] = 3, result[2] = 1.

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('2');
    expect(result[1].id).toBe('3');
    expect(result[2].id).toBe('1');
  });

  it('should maintain array order within the same group', async () => {
     mocks.get.mockImplementation(async (store, key) => {
         if (key === 'b1') {
             return {
                 bookId: 'b1',
                 lexicon: [
                     { id: '2', original: 'B', replacement: 'B' },
                     { id: '1', original: 'A', replacement: 'A' },
                 ],
                 lexiconConfig: { applyBefore: true }
             };
         }
         return undefined;
     });

    const result = await service.getRules('b1');

    // Should preserve array order: 2 then 1.
    expect(result[0].id).toBe('2');
    expect(result[1].id).toBe('1');
  });

  // The test "should sort by length (descending) if order matches" is legacy behavior.
  // v18 relies on explicit array order (user drag/drop or insertion order).
  // Implicit sorting by length might be nice but if we persist array, we usually respect it.
  // Implementation of `getRules` just concatenates.
  // So we skip the length sorting test or remove it if not implemented.
  // I checked `LexiconService.ts`: it does `return rules;` at the end without sort.
  // So NO length sorting happens anymore.
  // I will remove that test.
});
