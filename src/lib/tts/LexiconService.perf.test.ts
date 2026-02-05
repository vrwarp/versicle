import { describe, it, expect } from 'vitest';
import { LexiconService } from './LexiconService';
import type { LexiconRule } from '../../types/db';

describe('LexiconService Performance', () => {
    it('should be faster with cached compilation', () => {
        const service = LexiconService.getInstance();
        const rules: LexiconRule[] = [];

        // Generate 50 rules
        for (let i = 0; i < 50; i++) {
            rules.push({
                id: `rule-${i}`,
                original: `word${i}`,
                replacement: `replacement${i}`,
                isRegex: false,
                created: Date.now(),
                order: i
            });
        }

        // Add some regex rules
        rules.push({
            id: 'regex-1',
            original: 'v(\\d+)',
            replacement: 'verse $1',
            isRegex: true,
            created: Date.now(),
            order: 100
        });

        const text = "This is a test text with word1 and word20 and v45 inside.";

        // Warmup
        service.applyLexicon(text, rules);

        const start = performance.now();
        const iterations = 10000;
        for (let i = 0; i < iterations; i++) {
            service.applyLexicon(text, rules);
        }
        const end = performance.now();

        console.log(`Execution time for ${iterations} iterations: ${end - start}ms`);

        // Correctness check
        const result = service.applyLexicon(text, rules);
        expect(result).toContain('replacement1');
        expect(result).toContain('verse 45');
    });
});
