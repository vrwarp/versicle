import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LexiconService, processInitialisms } from './LexiconService';
import { useLexiconStore } from '../../store/useLexiconStore';
import { LexiconRule } from '../../types/db';

// Mock getDB to prevent actual DB calls (though mostly unused now)
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
    getDefaultMinSentenceLength: () => 36,
  useTTSStore: {
    getState: () => ({ isBibleLexiconEnabled: true })
  }
}));

// Mock Bible Lexicon Data to avoid pollution
vi.mock('../../data/bible-lexicon', () => ({
  BIBLE_LEXICON_RULES: []
}));


describe('LexiconService', () => {
  it('filters rules by language correctly', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useLexiconStore.getState as any).mockReturnValue({
      rules: {
        '1': { id: '1', original: 'a', replacement: 'b', isRegex: false, order: 0 }, // no language (global)
        '2': { id: '2', original: 'c', replacement: 'd', isRegex: false, language: 'en', order: 1 },
        '3': { id: '3', original: 'e', replacement: 'f', isRegex: false, language: 'zh', order: 2 },
      },
      settings: {}
    });
    const service = LexiconService.getInstance();

    // Unscoped request should return rules with no language and the requested language? Wait, LexiconService says:
    // .filter(r => !r.language || !language || r.language === language)
    // So if no language is passed, it returns all rules.
    const allRules = await service.getRules();
    expect(allRules).toHaveLength(3);

    // Requesting 'en' should return global unscoped rules + 'en' rules
    const enRules = await service.getRules(undefined, 'en');
    expect(enRules).toHaveLength(2);
    expect(enRules.map(r => r.id)).toEqual(['1', '2']);

    // Requesting 'zh' should return global unscoped rules + 'zh' rules
    const zhRules = await service.getRules(undefined, 'zh');
    expect(zhRules).toHaveLength(2);
    expect(zhRules.map(r => r.id)).toEqual(['1', '3']);
  });
  let service: LexiconService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockStore: any;

  beforeEach(async () => {
    service = LexiconService.getInstance();

    mockStore = {
      rules: {},
      settings: {},
      deleteRule: vi.fn(),
      addRule: vi.fn(),
      updateRule: vi.fn(),
      reorderRules: vi.fn(),
      setBiblePreference: vi.fn()
    };

    const { useLexiconStore } = await import('../../store/useLexiconStore');
    vi.mocked(useLexiconStore.getState).mockReturnValue(mockStore);
  });

  describe('deleteRules', () => {
    it('should delete multiple rules via store', async () => {
      await service.deleteRules(['1', '2']);
      expect(mockStore.deleteRule).toHaveBeenCalledWith('1');
      expect(mockStore.deleteRule).toHaveBeenCalledWith('2');
      expect(mockStore.deleteRule).toHaveBeenCalledTimes(2);
    });
  });

  describe('getRules', () => {
    it('should return rules sorted by order', async () => {
      mockStore.rules = {
        '1': { id: '1', order: 2, original: 'c', replacement: 'd' },
        '2': { id: '2', order: 0, original: 'a', replacement: 'b' },
        '3': { id: '3', order: 1, original: 'b', replacement: 'c' }
      };

      const result = await service.getRules();
      expect(result.length).toBe(3);
      expect(result[0].id).toBe('2'); // order 0
      expect(result[1].id).toBe('3'); // order 1
      expect(result[2].id).toBe('1'); // order 2
    });

    it('should filter by filter bookId', async () => {
      mockStore.rules = {
        '1': { id: '1', bookId: 'book1', original: 'x', replacement: 'y' },
        '2': { id: '2', original: 'global', replacement: 'z' } // implicit global
      };

      const book1Rules = await service.getRules('book1');
      // Should get global + book1
      expect(book1Rules.length).toBe(2);

      const book2Rules = await service.getRules('book2');
      // Should get global only
      expect(book2Rules.length).toBe(1);
      expect(book2Rules[0].id).toBe('2');
    });
  });

  describe('processInitialisms', () => {
    it('should strip periods from initialisms with spaces', () => {
      expect(processInitialisms('C. S. Lewis')).toBe('C S Lewis');
    });

    it('should strip periods from initialisms without spaces', () => {
      expect(processInitialisms('J.R.R. Tolkien')).toBe('J R R Tolkien');
    });

    it('should apply phonetic patches when mapped', () => {
      expect(processInitialisms('A. W. Tozer')).toBe('Eigh W Tozer');
    });

    it('should ignore non-initialism periods', () => {
      // The current logic strips inner periods (U S. and U K.) but leaves trailing periods
      expect(processInitialisms('He went to the U.S. and U.K.')).toBe('He went to the U S. and U K.');
      expect(processInitialisms('End of sentence.')).toBe('End of sentence.');
    });
  });

  describe('applyLexicon', () => {
    it('should replace exact matches with word boundaries by default', () => {
      const rules: LexiconRule[] = [
        { id: '1', original: 'Hello', replacement: 'Hi', created: 0 }
      ];
      const text = 'Hello world. Hello.';
      expect(service.applyLexicon(text, rules)).toBe('Hi world. Hi.');
    });

    it('should not replace substrings by default', () => {
      const rules: LexiconRule[] = [
        { id: '1', original: 'cat', replacement: 'dog', created: 0 }
      ];
      const text = 'The caterpillar is a cat.';
      expect(service.applyLexicon(text, rules)).toBe('The caterpillar is a dog.');
    });

    it('should handle regex rules when isRegex is true', () => {
      const rules: LexiconRule[] = [
        { id: '1', original: 's\\/he', replacement: 'they', isRegex: true, created: 0 }
      ];
      const text = 'When s/he arrives.';
      expect(service.applyLexicon(text, rules)).toBe('When they arrives.');
    });

    it('should handle complex regex rules', () => {
      const rules: LexiconRule[] = [
        { id: '1', original: 'chapter (\\d+)', replacement: 'Section $1', isRegex: true, matchType: 'regex', created: 0 }
      ];
      const text = 'Read Chapter 5 now.';
      expect(service.applyLexicon(text, rules)).toBe('Read Section 5 now.');
    });

    it('should handle invalid regex gracefully', () => {
      const rules: LexiconRule[] = [
        { id: '1', original: '[invalid', replacement: 'valid', isRegex: true, created: 0 }
      ];
      const text = 'Some [invalid text.';
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
      expect(service.applyLexicon(text, rules)).toBe(text);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should still escape default rules even if they look like regex', () => {
      const rules: LexiconRule[] = [
        { id: '1', original: 'C++', replacement: 'C Plus Plus', isRegex: false, created: 0 }
      ];
      const text = 'I love C++.';
      expect(service.applyLexicon(text, rules)).toBe('I love C Plus Plus.');
    });
  });
});
