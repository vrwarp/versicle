import { describe, it, expect, vi } from 'vitest';
import { SearchEngine } from './search-engine';

describe('SearchEngine Predictability and Reliability', () => {
    it('safeguards against infinite loops on zero-width matches', () => {
        const engine = new SearchEngine();
        engine.initIndex('bug-test');
        engine.addDocuments('bug-test', [
            { id: 's1', href: 'ch1.xhtml', text: 'This is a test document.' },
        ]);

        const originalRegExp = global.RegExp;

        try {
            // Mock the RegExp constructor to return a zero-width matching regex
            // when the query is 'dummy query' (which becomes 'dummy\\ query').
            (global as any).RegExp = new Proxy(originalRegExp, {
                construct(target, args) {
                    if (args[0] === 'dummy\\ query') {
                        return new target('(?:)', 'gi');
                    }
                    return new target(...(args as [string, string]));
                }
            });

            // `engine.search` will use `new RegExp('(?:)', 'gi')`
            const results = engine.search('bug-test', 'dummy query');

            // The search should terminate and return an empty array,
            // since zero-width matches are skipped
            expect(results).toEqual([]);
        } finally {
            global.RegExp = originalRegExp;
        }
    });
});
