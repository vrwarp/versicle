import { describe, it, expect } from 'vitest';
import { SearchEngine } from './search-engine';
import { SeededRandom, DEFAULT_FUZZ_SEED, DEFAULT_FUZZ_ITERATIONS } from '../test/fuzz-utils';
import type { SearchSection } from '../types/search';

describe('SearchEngine Fuzzing', () => {
    const SEED = DEFAULT_FUZZ_SEED;

    describe('search() regex escaping', () => {
        it('survives queries with regex special characters', () => {
            const rng = new SeededRandom(SEED);
            const engine = new SearchEngine();

            // Index some content
            engine.initIndex('test-book');
            engine.addDocuments('test-book', [
                { id: 'section-1', href: 'chapter1.xhtml', text: 'Hello world. This is a test document with various words.' },
                { id: 'section-2', href: 'chapter2.xhtml', text: 'Another section with more content (including parentheses) and [brackets].' },
            ]);

            const regexChars = ['*', '+', '?', '^', '$', '{', '}', '(', ')', '[', ']', '|', '\\', '.'];

            for (let i = 0; i < DEFAULT_FUZZ_ITERATIONS; i++) {
                // Build a query with potential regex issues
                let query = '';
                const queryLen = rng.nextInt(1, 20);
                for (let j = 0; j < queryLen; j++) {
                    if (rng.nextBool()) {
                        query += rng.nextElement(regexChars);
                    } else {
                        query += rng.nextElement(['a', 'b', 'c', 'd', 'e', 'test', 'word', ' ']);
                    }
                }

                try {
                    const results = engine.search('test-book', query);
                    expect(Array.isArray(results)).toBe(true);
                } catch (e) {
                    console.error(`Crashed on query (seed=${SEED}, iteration=${i}): ${query}`);
                    throw e;
                }
            }
        });

        it('survives random Unicode queries', () => {
            const rng = new SeededRandom(SEED);
            const engine = new SearchEngine();

            engine.initIndex('unicode-book');
            engine.addDocuments('unicode-book', [
                { id: 'section-1', href: 'ch1.xhtml', text: 'Hello 世界. 日本語テスト. Emoji 😀🔥.' },
            ]);

            for (let i = 0; i < DEFAULT_FUZZ_ITERATIONS; i++) {
                const query = rng.nextUnicodeString(rng.nextInt(0, 30));

                try {
                    const results = engine.search('unicode-book', query);
                    expect(Array.isArray(results)).toBe(true);
                } catch (e) {
                    console.error(`Crashed on Unicode query (seed=${SEED}, iteration=${i}): ${query}`);
                    throw e;
                }
            }
        });

        it('handles empty and whitespace queries', () => {
            const engine = new SearchEngine();
            engine.initIndex('test-book');
            engine.addDocuments('test-book', [
                { id: 'section-1', href: 'ch1.xhtml', text: 'Some content here.' },
            ]);

            expect(engine.search('test-book', '')).toEqual([]);
            expect(engine.search('test-book', '   ')).toEqual([]);
            expect(engine.search('test-book', '\t\n')).toEqual([]);
        });
    });

    describe('addDocuments()', () => {
        it('survives random document content', () => {
            const rng = new SeededRandom(SEED);
            const engine = new SearchEngine();

            for (let i = 0; i < 100; i++) {
                const bookId = `book-${i}`;
                engine.initIndex(bookId);

                const numDocs = rng.nextInt(1, 20);
                const documents: SearchSection[] = [];

                for (let j = 0; j < numDocs; j++) {
                    const hasText = rng.nextBool();
                    const hasXml = !hasText && rng.nextBool();

                    documents.push({
                        id: `section-${j}`,
                        href: `chapter${j}.xhtml`,
                        text: hasText ? rng.nextUnicodeString(rng.nextInt(0, 500)) : undefined,
                        xml: hasXml ? `<html><body>${rng.nextUnicodeString(rng.nextInt(0, 200))}</body></html>` : undefined,
                    });
                }

                try {
                    engine.addDocuments(bookId, documents);
                } catch (e) {
                    console.error(`Crashed on iteration ${i} (seed=${SEED}) with ${numDocs} documents`);
                    throw e;
                }
            }
        });

        it('handles malformed XML gracefully', () => {
            const rng = new SeededRandom(SEED);
            const engine = new SearchEngine();

            const malformedXmls = [
                '<unclosed',
                '<a><b></a></b>',
                '<<double>>',
                '<![CDATA[ unclosed',
                rng.nextUnicodeString(100),
            ];

            engine.initIndex('malformed-book');

            const documents: SearchSection[] = malformedXmls.map((xml, i) => ({
                id: `section-${i}`,
                href: `chapter${i}.xhtml`,
                xml,
            }));

            try {
                // Should not crash, may log warnings
                engine.addDocuments('malformed-book', documents);
            } catch (e) {
                console.error('Crashed on malformed XML');
                throw e;
            }
        });
    });

    describe('getExcerpt()', () => {
        it('handles edge cases for excerpt generation', () => {
            const engine = new SearchEngine();
            engine.initIndex('excerpt-test');

            // Test excerpt generation through search
            engine.addDocuments('excerpt-test', [
                // Very short text
                { id: 's1', href: 'ch1.xhtml', text: 'Hi' },
                // Very long text with match at various positions
                { id: 's2', href: 'ch2.xhtml', text: 'A'.repeat(100) + 'FINDME' + 'B'.repeat(100) },
                // Match at start
                { id: 's3', href: 'ch3.xhtml', text: 'START of text here' },
                // Match at end
                { id: 's4', href: 'ch4.xhtml', text: 'here at the END' },
            ]);

            const testQueries = ['Hi', 'FINDME', 'START', 'END'];

            for (const query of testQueries) {
                try {
                    const results = engine.search('excerpt-test', query);
                    expect(Array.isArray(results)).toBe(true);

                    for (const result of results) {
                        expect(typeof result.excerpt).toBe('string');
                    }
                } catch (e) {
                    console.error(`Crashed on excerpt query: ${query}`);
                    throw e;
                }
            }
        });
    });

    describe('Edge cases', () => {
        it('handles search on non-existent book', () => {
            const engine = new SearchEngine();

            const results = engine.search('non-existent', 'test');
            expect(results).toEqual([]);
        });

        it('handles very long queries', () => {
            const rng = new SeededRandom(SEED);
            const engine = new SearchEngine();

            engine.initIndex('long-query-test');
            engine.addDocuments('long-query-test', [
                { id: 's1', href: 'ch1.xhtml', text: 'Some content here.' },
            ]);

            const longQuery = rng.nextString(1000);

            try {
                const results = engine.search('long-query-test', longQuery);
                expect(Array.isArray(results)).toBe(true);
            } catch (e) {
                console.error('Crashed on very long query');
                throw e;
            }
        });

        it('handles special regex character sequences', () => {
            const engine = new SearchEngine();
            engine.initIndex('regex-test');
            engine.addDocuments('regex-test', [
                { id: 's1', href: 'ch1.xhtml', text: 'Test (content) with [brackets] and {braces}.' },
            ]);

            const dangerousQueries = [
                '(?:)',
                '\\b',
                '\\d+',
                '[^a-z]',
                'a{1,3}',
                'a(?=b)',
                'a(?!b)',
                '(?<=a)b',
                '(?<!a)b',
            ];

            for (const query of dangerousQueries) {
                try {
                    const results = engine.search('regex-test', query);
                    expect(Array.isArray(results)).toBe(true);
                } catch (e) {
                    console.error(`Crashed on dangerous regex query: ${query}`);
                    throw e;
                }
            }
        });
    });
});
