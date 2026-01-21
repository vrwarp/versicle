import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LexiconService } from './LexiconService';
import { LexiconRule } from '../../types/db';

// Mock DB (not used directly anymore but safe to mock)
vi.mock('../../db/db', () => ({
  getDB: vi.fn(),
}));

// Mock store and sync
vi.mock('../../store/useLexiconStore', () => ({
  useLexiconStore: {
    getState: vi.fn(),
  }
}));

vi.mock('../../store/yjs-provider', () => ({
  waitForYjsSync: vi.fn().mockResolvedValue(),
}));

// Mock TTS Store for Bible preference check
vi.mock('../../store/useTTSStore', () => ({
  useTTSStore: {
    getState: () => ({ isBibleLexiconEnabled: false })
  }
}));

describe('LexiconService Sorting', () => {
  let service: LexiconService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockStore: any;

  beforeEach(async () => {
    service = LexiconService.getInstance();
    // Disable Bible lexicon for sorting tests to avoid polluting the rule list
    service.setGlobalBibleLexiconEnabled(false);

    mockStore = {
      rules: {},
      settings: {},
    };

    const { useLexiconStore } = await import('../../store/useLexiconStore');
    vi.mocked(useLexiconStore.getState).mockReturnValue(mockStore);
  });

  const setRules = (rules: LexiconRule[]) => {
    const map: Record<string, LexiconRule> = {};
    rules.forEach(r => map[r.id] = r);
    mockStore.rules = map;
  };

  it('should prioritize Book rules before Global rules when applyBefore is true', async () => {
    setRules([
      { id: 'g1', original: 'Global', replacement: 'G', created: 0, bookId: 'global' },
      { id: 'b1', original: 'Book', replacement: 'B', created: 0, bookId: 'b1', applyBeforeGlobal: true }
    ]);

    const result = await service.getRules('b1');

    // Expected order: Book Rule -> Global Rule
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('b1');
    expect(result[1].id).toBe('g1');
  });

  it('should prioritize Global rules before Book rules when applyBefore is false/undefined', async () => {
    setRules([
      { id: 'g1', original: 'Global', replacement: 'G', created: 0, bookId: 'global' },
      { id: 'b1', original: 'Book', replacement: 'B', created: 0, bookId: 'b1', applyBeforeGlobal: false }
    ]);

    const result = await service.getRules('b1');

    // Expected order: Global Rule -> Book Rule
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('g1');
    expect(result[1].id).toBe('b1');
  });

  it('should handle mixed priorities within the same book', async () => {
    setRules([
      { id: 'g1', original: 'Global', replacement: 'G', created: 0, bookId: 'global' },
      { id: 'b_after', original: 'After', replacement: 'A', created: 0, bookId: 'b1', applyBeforeGlobal: false },
      { id: 'b_before', original: 'Before', replacement: 'B', created: 0, bookId: 'b1', applyBeforeGlobal: true }
    ]);

    const result = await service.getRules('b1');

    // Expected order: Book Before -> Global -> Book After
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('b_before');
    expect(result[1].id).toBe('g1');
    expect(result[2].id).toBe('b_after');
  });

  it('should maintain array order within the same group (order field sorting)', async () => {
    // Tests new "order" field logic
    setRules([
      { id: '2', original: 'Short', replacement: 'S', created: 0, bookId: 'b1', applyBeforeGlobal: true, order: 0 },
      { id: '1', original: 'VeryLongOriginalText', replacement: 'L', created: 0, bookId: 'b1', applyBeforeGlobal: true, order: 1 },
    ]);

    const result = await service.getRules('b1');

    // Expected order: Sort by 'order' field (0 then 1)
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('2');
    expect(result[1].id).toBe('1');
  });

  // Replaced "lexiconConfig" tests with direct property testing since migration handles format
  it('should respect order within priority groups', async () => {
    setRules([
      { id: 'g_early', original: 'GE', replacement: 'G', created: 0, bookId: 'global', order: 0 },
      { id: 'g_late', original: 'GL', replacement: 'G', created: 0, bookId: 'global', order: 10 },

      { id: 'b_high_1', original: 'H1', replacement: 'H', created: 0, bookId: 'b1', applyBeforeGlobal: true, order: 5 },
      { id: 'b_high_2', original: 'H2', replacement: 'H', created: 0, bookId: 'b1', applyBeforeGlobal: true, order: 2 },

      { id: 'b_low_1', original: 'L1', replacement: 'L', created: 0, bookId: 'b1', applyBeforeGlobal: false, order: 1 },
      { id: 'b_low_2', original: 'L2', replacement: 'L', created: 0, bookId: 'b1', applyBeforeGlobal: false, order: 0 },
    ]);

    const result = await service.getRules('b1');

    // Expected Order: 
    // 1. High Priority (Sorted by Order: b_high_2 (2) -> b_high_1 (5))
    // 2. Global (Sorted by Order: g_early (0) -> g_late (10))
    // 3. Low Priority (Sorted by Order: b_low_2 (0) -> b_low_1 (1))

    expect(result).toHaveLength(6);

    // High
    expect(result[0].id).toBe('b_high_2');
    expect(result[1].id).toBe('b_high_1');

    // Global
    expect(result[2].id).toBe('g_early');
    expect(result[3].id).toBe('g_late');

    // Low
    expect(result[4].id).toBe('b_low_2');
    expect(result[5].id).toBe('b_low_1');
  });
});
