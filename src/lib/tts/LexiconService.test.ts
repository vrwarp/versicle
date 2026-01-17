import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LexiconService } from './LexiconService';
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
  useTTSStore: {
    getState: () => ({ isBibleLexiconEnabled: true })
  }
}));

// Mock Bible Lexicon Data to avoid pollution
vi.mock('../../data/bible-lexicon', () => ({
  BIBLE_LEXICON_RULES: []
}));


describe('LexiconService', () => {
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
        { id: '1', original: 'chapter (\\d+)', replacement: 'Section $1', isRegex: true, created: 0 }
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
