import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LexiconService } from './LexiconService';
import type { LexiconRule } from '../../types/db';

const mocks = vi.hoisted(() => {
  return {
    getAll: vi.fn(),
  };
});

vi.mock('../../db/db', () => ({
  getDB: vi.fn().mockResolvedValue({
    getAll: mocks.getAll,
  }),
}));

describe('LexiconService Sorting', () => {
  let service: LexiconService;

  beforeEach(() => {
    service = LexiconService.getInstance();
    vi.clearAllMocks();
  });

  it('should sort rules by Priority Group, then Order, then Length', async () => {
    const rules: LexiconRule[] = [
      { id: '1', original: 'Global', replacement: 'G', created: 0 },
      { id: '2', original: 'BookPost', replacement: 'BP', bookId: 'b1', created: 0 },
      { id: '3', original: 'BookPre', replacement: 'BPre', bookId: 'b1', applyBeforeGlobal: true, created: 0 },
      { id: '4', original: 'OtherBook', replacement: 'OB', bookId: 'b2', created: 0 }, // Should be filtered out
    ];

    mocks.getAll.mockResolvedValue(rules);

    const result = await service.getRules('b1');

    // Expected order:
    // 1. BookPre (Group 1)
    // 2. Global (Group 2)
    // 3. BookPost (Group 3)

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('3');
    expect(result[1].id).toBe('1');
    expect(result[2].id).toBe('2');
  });

  it('should sort by order within the same group', async () => {
     const rules: LexiconRule[] = [
      { id: '1', original: 'A', replacement: 'A', bookId: 'b1', applyBeforeGlobal: true, order: 2, created: 0 },
      { id: '2', original: 'B', replacement: 'B', bookId: 'b1', applyBeforeGlobal: true, order: 1, created: 0 },
    ];
    mocks.getAll.mockResolvedValue(rules);

    const result = await service.getRules('b1');

    expect(result[0].id).toBe('2');
    expect(result[1].id).toBe('1');
  });

  it('should sort by length (descending) if order matches within group', async () => {
       const rules: LexiconRule[] = [
      { id: '1', original: 'Short', replacement: 'A', bookId: 'b1', applyBeforeGlobal: true, created: 0 },
      { id: '2', original: 'LongerString', replacement: 'B', bookId: 'b1', applyBeforeGlobal: true, created: 0 },
    ];
    mocks.getAll.mockResolvedValue(rules);

    const result = await service.getRules('b1');

    expect(result[0].id).toBe('2'); // Longer
    expect(result[1].id).toBe('1'); // Shorter
  });
});
