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
        // We expect "a" suffix to be capitalized to force long vowel pronunciation
        // "Matthew 1:2a" -> "Matthew 1:2 A"
        let result = service.applyLexicon('Matthew 1:2a', rules);
        // We check if it ends with "2 A" or "2 Ay" or similar.
        // Based on my plan, I will use " A".
        expect(result).toMatch(/Matthew 1:2 A$/);

        result = service.applyLexicon('v43a', rules);
        // Note: Existing rules replace 'v' with 'verse' directly, so 'v43' becomes 'verse43' without space if none existed.
        // We focus on verifying the 'a' suffix becomes ' A'.
        expect(result).toMatch(/verse\s*43 A$/);

        // "vv. 5b-7a" -> "verse 5b-7 A"
        result = service.applyLexicon('vv. 5b-7a', rules);
        expect(result).toContain('verse 5b-7 A');
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
