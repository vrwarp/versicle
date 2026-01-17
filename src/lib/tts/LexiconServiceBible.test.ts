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

vi.mock('../../data/bible-lexicon', () => ({
  BIBLE_LEXICON_RULES: [
      { original: 'Bible', replacement: 'Bib', isRegex: false }
  ]
}));

describe('LexiconService Bible Order', () => {
  let service: LexiconService;

  beforeEach(() => {
    service = LexiconService.getInstance();
    vi.clearAllMocks();

    vi.mock('../../store/useTTSStore', () => ({
        useTTSStore: {
            getState: () => ({ isBibleLexiconEnabled: true })
        }
    }));
  });

  it('should place Bible rules between Global and Book(after) rules', async () => {
    mocks.get.mockImplementation(async (_store, key) => {
      if (key === 'global') {
        return {
          bookId: 'global',
          lexicon: [
            { id: 'g1', original: 'Global', replacement: 'G', created: 0, applyBeforeGlobal: false }
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

    // Desired order: Book(before) -> Global -> Bible -> Book(after)
    const ids = result.map(r => r.id);

    // Bible rule id is constructed as `bible-${index}` in LexiconService
    expect(ids).toEqual(['b_before', 'g1', 'bible-0', 'b_after']);
  });
});
