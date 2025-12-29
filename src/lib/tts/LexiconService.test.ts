import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LexiconService } from './LexiconService';
import { LexiconRule } from '../../types/db';

// Mock getDB to prevent actual DB calls
vi.mock('../../db/db', () => ({
  getDB: vi.fn(),
}));

describe('LexiconService', () => {
  let service: LexiconService;

  beforeEach(() => {
    service = LexiconService.getInstance();
  });

  describe('deleteRules', () => {
    it('should delete multiple rules', async () => {
      const db = {
        transaction: vi.fn().mockReturnValue({
          objectStore: vi.fn().mockReturnValue({
            delete: vi.fn().mockResolvedValue(undefined),
          }),
          done: Promise.resolve(),
        }),
      };
      // Mock getDB to return our mock db
      const { getDB } = await import('../../db/db');
      vi.mocked(getDB).mockResolvedValue(db as any);

      await service.deleteRules(['1', '2']);

      expect(db.transaction).toHaveBeenCalledWith('lexicon', 'readwrite');
      const store = db.transaction().objectStore();
      expect(store.delete).toHaveBeenCalledWith('1');
      expect(store.delete).toHaveBeenCalledWith('2');
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
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
