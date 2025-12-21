import { describe, it, expect } from 'vitest';
import { SearchEngine } from './search-engine';

describe('SearchEngine XML Parsing', () => {
    it('should parse XML in addDocuments', () => {
        const engine = new SearchEngine();
        const bookId = 'test-book';
        const xml = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hello <b>World</b></p></body></html>';

        const section = {
            id: '1',
            href: 'ch1.html',
            xml: xml
        };

        // Initialize index implicitly via addDocuments
        engine.addDocuments(bookId, [section]);

        // Search for "Hello"
        const resultsHello = engine.search(bookId, 'Hello');
        expect(resultsHello.length).toBeGreaterThan(0);
        expect(resultsHello[0].excerpt).toContain('Hello');

        // Search for "World"
        const resultsWorld = engine.search(bookId, 'World');
        expect(resultsWorld.length).toBeGreaterThan(0);
        expect(resultsWorld[0].excerpt).toContain('World');

        // Ensure tags are stripped (not searchable)
        const resultsTag = engine.search(bookId, 'body');
        expect(resultsTag.length).toBe(0);
    });

    it('should prefer text if provided over XML', () => {
        const engine = new SearchEngine();
        const bookId = 'test-book-2';
        const xml = '<body>ignored</body>';

        const section = {
            id: '1',
            href: 'ch1.html',
            xml: xml,
            text: 'Used'
        };

        engine.addDocuments(bookId, [section]);

        const results = engine.search(bookId, 'Used');
        expect(results.length).toBeGreaterThan(0);

        const resultsIgnored = engine.search(bookId, 'ignored');
        expect(resultsIgnored.length).toBe(0);
    });

    it('should report supportsXmlParsing as true in JSDOM', () => {
        const engine = new SearchEngine();
        expect(engine.supportsXmlParsing()).toBe(true);
    });
});
