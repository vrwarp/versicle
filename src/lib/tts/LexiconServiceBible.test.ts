import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LexiconService } from './LexiconService';
import { LexiconRule } from '../../types/db';

const mocks = vi.hoisted(() => {
  return {
    get: vi.fn(),
    bibleLexiconRules: [
      { original: 'Bible', replacement: 'Bib', isRegex: false }
    ]
  };
});

// Mock DB (safe to mock even if unused)
vi.mock('../../db/db', () => ({
  getDB: vi.fn().mockResolvedValue({
    get: mocks.get,
  }),
}));

// Mock Bible Lexicon Data
vi.mock('../../data/bible-lexicon', () => ({
  BIBLE_LEXICON_RULES: mocks.bibleLexiconRules
}));

// Mock store and sync
vi.mock('../../store/useLexiconStore', () => ({
  useLexiconStore: {
    getState: vi.fn(),
  }
}));

vi.mock('../../store/yjs-provider', () => ({
  waitForYjsSync: vi.fn().mockImplementation(() => Promise.resolve()),
}));

// Mock TTS Store for Bible preference check
vi.mock('../../store/useTTSStore', () => ({
  useTTSStore: {
    getState: () => ({ isBibleLexiconEnabled: true })
  }
}));

describe('LexiconService Bible Order', () => {
  let service: LexiconService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockStore: any;

  beforeEach(async () => {
    service = LexiconService.getInstance();

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

  it('should place Bible rules between Global and Book(after) rules', async () => {
    setRules([
      // Global Rule
      { id: 'g1', original: 'Global', replacement: 'G', created: 0, bookId: 'global', applyBeforeGlobal: false, order: 2 },

      // Book Before (High Priority)
      { id: 'b_before', original: 'Before', replacement: 'B', created: 0, bookId: 'b1', applyBeforeGlobal: true, order: 1 },

      // Book After (Low Priority)
      { id: 'b_after', original: 'After', replacement: 'A', created: 0, bookId: 'b1', applyBeforeGlobal: false, order: 3 }
    ]);

    const result = await service.getRules('b1');

    // Verify Rule Priority Order:
    // 1. High Priority Book Rules (applyBeforeGlobal: true)
    // 2. Global Rules
    // 3. Bible Rules (System defaults, but applied before low-priority/standard book rules)
    // 4. Low Priority Book Rules (Standard user overrides)

    const ids = result.map(r => r.id);
    expect(ids).toEqual(['b_before', 'g1', 'bible-0', 'b_after']);
  });
});
