import { describe, it, expect } from 'vitest';
import { BIBLE_LEXICON_RULES } from '../../data/bible-lexicon';
import { LexiconService } from './LexiconService';

describe('Bible Lexicon Rules', () => {
    const service = LexiconService.getInstance();

    // Prepare rules as the service expects them
    const rules = BIBLE_LEXICON_RULES.map((r, i) => ({
        ...r,
        id: `bible-${i}`,
        created: 0,
        order: i,
        bookId: 'global' // Dummy
    }));

    it('pronounces verse suffixes correctly', () => {
        // We expect "a" suffix to be replaced with "ae" to force long vowel pronunciation
        // "Matthew 1:2a" -> "Matthew 1:2 ae"
        let result = service.applyLexicon('Matthew 1:2a', rules);
        expect(result).toMatch(/Matthew 1:2 ae$/);

        result = service.applyLexicon('v43a', rules);
        // "v43" -> "verse 43" (now with space)
        // "43a" -> "43 ae"
        expect(result).toMatch(/verse 43 ae$/);

        // "vv. 5b-7a" -> "verse 5b-7 ae"
        result = service.applyLexicon('vv. 5b-7a', rules);
        expect(result).toContain('verse 5b-7 ae');
    });

    it('preserves other text', () => {
        const text = "This is a test 123.";
        const result = service.applyLexicon(text, rules);
        expect(result).toBe(text);
    });

    it('does not affect times like 1 a.m.', () => {
        const text = "It was 1 a.m.";
        const result = service.applyLexicon(text, rules);
        expect(result).toBe(text);
    });
});
