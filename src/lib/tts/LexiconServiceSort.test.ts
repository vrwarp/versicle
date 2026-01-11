import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LexiconService } from './LexiconService';

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

    // Mock dynamic import for useTTSStore to disable Bible Lexicon by default in these tests
    // This assumes the dynamic import in LexiconService will use this mock.
    vi.mock('../../store/useTTSStore', () => ({
        useTTSStore: {
            getState: () => ({ isBibleLexiconEnabled: false })
        }
    }));
  });

  it('should prioritize Book rules before Global rules when applyBefore is true', async () => {
    mocks.get.mockImplementation(async (_store, key) => {
      if (key === 'global') {
        return {
          bookId: 'global',
          lexicon: [
            { id: 'g1', original: 'Global', replacement: 'G', created: 0 }
          ]
        };
      }
      if (key === 'b1') {
        return {
          bookId: 'b1',
          lexicon: [
            { id: 'b1', original: 'Book', replacement: 'B', created: 0, applyBeforeGlobal: true }
          ]
        };
      }
      return undefined;
    });

    const result = await service.getRules('b1');

    // Expected order: Book Rule -> Global Rule
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('b1');
    expect(result[1].id).toBe('g1');
  });

  it('should prioritize Global rules before Book rules when applyBefore is false/undefined', async () => {
    mocks.get.mockImplementation(async (_store, key) => {
      if (key === 'global') {
        return {
          bookId: 'global',
          lexicon: [
            { id: 'g1', original: 'Global', replacement: 'G', created: 0 }
          ]
        };
      }
      if (key === 'b1') {
        return {
          bookId: 'b1',
          lexicon: [
            { id: 'b1', original: 'Book', replacement: 'B', created: 0, applyBeforeGlobal: false }
          ]
        };
      }
      return undefined;
    });

    const result = await service.getRules('b1');

    // Expected order: Global Rule -> Book Rule
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('g1');
    expect(result[1].id).toBe('b1');
  });

  it('should handle mixed priorities within the same book', async () => {
    mocks.get.mockImplementation(async (_store, key) => {
      if (key === 'global') {
        return {
          bookId: 'global',
          lexicon: [
            { id: 'g1', original: 'Global', replacement: 'G', created: 0 }
          ]
        };
      }
      if (key === 'b1') {
        return {
          bookId: 'b1',
          lexicon: [
            { id: 'b_after', original: 'After', replacement: 'A', created: 0, applyBeforeGlobal: false },
            { id: 'b_before', original: 'Before', replacement: 'B', created: 0, applyBeforeGlobal: true }
          ]
        };
      }
      return undefined;
    });

    const result = await service.getRules('b1');

    // Expected order: Book Before -> Global -> Book After
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('b_before');
    expect(result[1].id).toBe('g1');
    expect(result[2].id).toBe('b_after');
  });

  it('should maintain array order within the same group (no length sorting)', async () => {
    // This test confirms that no implicit sorting (like by length) occurs,
    // and the order defined in the storage array is respected.
    mocks.get.mockImplementation(async (_store, key) => {
      if (key === 'b1') {
        return {
          bookId: 'b1',
          lexicon: [
            { id: '2', original: 'Short', replacement: 'S', created: 0, applyBeforeGlobal: true },
            { id: '1', original: 'VeryLongOriginalText', replacement: 'L', created: 0, applyBeforeGlobal: true },
          ]
        };
      }
      return undefined;
    });

    const result = await service.getRules('b1');

    // Expected order: Same as input array (2, 1) regardless of length
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('2');
    expect(result[1].id).toBe('1');
  });

  it('should fallback to lexiconConfig for legacy rules', async () => {
      mocks.get.mockImplementation(async (_store, key) => {
        if (key === 'global') {
          return {
            bookId: 'global',
            lexicon: [
              { id: 'g1', original: 'Global', replacement: 'G', created: 0 }
            ]
          };
        }
        if (key === 'b1') {
          return {
            bookId: 'b1',
            lexicon: [
              // Rule without applyBeforeGlobal
              { id: 'b_legacy', original: 'Legacy', replacement: 'L', created: 0 }
            ],
            // Legacy configuration
            lexiconConfig: { applyBefore: true }
          };
        }
        return undefined;
      });

      const result = await service.getRules('b1');

      // Expected order: Book Rule (using fallback) -> Global Rule
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('b_legacy');
      expect(result[1].id).toBe('g1');
  });

  it('should prefer per-rule setting over legacy config', async () => {
    mocks.get.mockImplementation(async (_store, key) => {
      if (key === 'global') {
        return {
          bookId: 'global',
          lexicon: [
            { id: 'g1', original: 'Global', replacement: 'G', created: 0 }
          ]
        };
      }
      if (key === 'b1') {
        return {
          bookId: 'b1',
          lexicon: [
            // Rule explicitly overriding legacy config (false vs true)
            { id: 'b_override', original: 'Override', replacement: 'O', created: 0, applyBeforeGlobal: false }
          ],
          // Legacy configuration
          lexiconConfig: { applyBefore: true }
        };
      }
      return undefined;
    });

    const result = await service.getRules('b1');

    // Expected order: Global Rule -> Book Rule (per-rule false overrides config true)
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('g1');
    expect(result[1].id).toBe('b_override');
});
});
