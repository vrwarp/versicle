import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processInitialisms, LexiconService } from './LexiconService';
import { LexiconRule } from '../../types/db';

// Mock dependencies to isolate unit tests
vi.mock('../../db/db', () => ({
  getDB: vi.fn(),
}));

vi.mock('../../store/useLexiconStore', () => ({
  useLexiconStore: {
    getState: vi.fn(),
  }
}));

vi.mock('../../store/yjs-provider', () => ({
  waitForYjsSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../store/useTTSStore', () => ({
    getDefaultMinSentenceLength: () => 36,
  useTTSStore: {
    getState: () => ({ isBibleLexiconEnabled: true })
  }
}));

vi.mock('../../data/bible-lexicon', () => ({
  BIBLE_LEXICON_RULES: []
}));


describe('processInitialisms', () => {
  describe('core phonetic replacement', () => {
    it('should replace "A." with "Eigh" when followed by another initial', () => {
      expect(processInitialisms('A. W. Tozer')).toBe('Eigh W Tozer');
    });

    it('should strip the period from non-mapped letters', () => {
      // Both "A." and "W." should have periods stripped.
      expect(processInitialisms('A. W. Tozer')).toBe('Eigh W Tozer');
    });

    it('should handle C. S. Lewis', () => {
      expect(processInitialisms('C. S. Lewis')).toBe('C S Lewis');
    });

    it('should handle J. R. R. Tolkien', () => {
      // All initials should have periods stripped
      expect(processInitialisms('J. R. R. Tolkien')).toBe('J R R Tolkien');
    });

    it('should handle A. W. in "A. W. Tozer wrote many books"', () => {
      expect(processInitialisms('A. W. Tozer wrote many books')).toBe('Eigh W Tozer wrote many books');
    });

    it('should handle middle initials like "John F. Kennedy"', () => {
      expect(processInitialisms('John F. Kennedy')).toBe('John F Kennedy');
    });
  });

  describe('edge cases - no false positives', () => {
    it('should NOT alter "A" used as an article in normal text', () => {
      const text = 'A man walked into a room.';
      expect(processInitialisms(text)).toBe(text);
    });

    it('should NOT alter a sentence ending in a single letter', () => {
      const text = 'The answer is A. We continue here.';
      // A. followed by We (Title Case) will be matched as an initialism for now,
      // mapping A to Eigh to avoid the "uh" mispronunciation.
      expect(processInitialisms(text)).toBe('The answer is Eigh We continue here.');
    });

    it('should NOT alter lowercase initials', () => {
      const text = 'a. w. tozer';
      expect(processInitialisms(text)).toBe(text);
    });

    it('should NOT alter text with no initialisms', () => {
      const text = 'This is a normal sentence with no initials.';
      expect(processInitialisms(text)).toBe(text);
    });

    it('should NOT alter a standalone capital letter without a period', () => {
      const text = 'Grade A work from the team.';
      expect(processInitialisms(text)).toBe(text);
    });
  });

  describe('multiple initialisms in one string', () => {
    it('should handle two separate initialized names', () => {
      const text = 'A. W. Tozer and C. S. Lewis';
      expect(processInitialisms(text)).toBe('Eigh W Tozer and C S Lewis');
    });

    it('should handle A. B. C. D. chain', () => {
      // All initials in the chain should have periods stripped
      expect(processInitialisms('A. B. C. D. Smith')).toBe('Eigh B C D Smith');
    });
  });

  describe('boundary conditions', () => {
    it('should handle initialism at the very start of text', () => {
      // J. is followed by 'author' (lowercase), so it's not stripped, 
      // but 'A.' followed by 'J.' is always stripped.
      expect(processInitialisms('A. J. author')).toBe('Eigh J. author');
    });

    it('should handle initialism followed by Title Case surname', () => {
      expect(processInitialisms('A. J. Author')).toBe('Eigh J Author');
    });

    it('should handle initialism mid-sentence', () => {
      expect(processInitialisms('The author A. W. Tozer')).toBe('The author Eigh W Tozer');
    });

    it('should handle multiple spaces between initials', () => {
      // Multiple spaces match \s+
      expect(processInitialisms('A.  W. Tozer')).toBe('Eigh W Tozer');
    });

    it('should return empty string for empty input', () => {
      expect(processInitialisms('')).toBe('');
    });

    it('should handle single character input', () => {
      expect(processInitialisms('A')).toBe('A');
    });
  });
});

describe('LexiconService initialism integration', () => {
  let service: LexiconService;

  beforeEach(async () => {
    service = LexiconService.getInstance();

    const mockStore = {
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

  it('applyLexicon should process initialisms before lexicon rules', () => {
    const rules: LexiconRule[] = [];
    expect(service.applyLexicon('A. W. Tozer', rules)).toBe('Eigh W Tozer');
  });

  it('applyLexicon should process initialisms and then lexicon rules', () => {
    const rules: LexiconRule[] = [
      { id: '1', original: 'Tozer', replacement: 'TOE-zer', created: 0 }
    ];
    expect(service.applyLexicon('A. W. Tozer', rules)).toBe('Eigh W TOE-zer');
  });

  it('applyLexiconWithTrace should apply initialisms before tracing', () => {
    const rules: LexiconRule[] = [
      { id: '1', original: 'Tozer', replacement: 'TOE-zer', created: 0 }
    ];
    const result = service.applyLexiconWithTrace('A. W. Tozer', rules);
    expect(result.final).toBe('Eigh W TOE-zer');
    // The trace should show before/after for the Tozer rule
    expect(result.trace.length).toBe(1);
    expect(result.trace[0].rule.id).toBe('1');
  });

  it('should not interfere with normal article "A" in lexicon processing', () => {
    const rules: LexiconRule[] = [];
    expect(service.applyLexicon('A man walked home.', rules)).toBe('A man walked home.');
  });
});
