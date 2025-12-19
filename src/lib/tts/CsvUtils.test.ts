import { describe, it, expect } from 'vitest';
import { LexiconCSV, SimpleListCSV } from './CsvUtils';
import type { LexiconRule } from '../../types/db';

describe('LexiconCSV', () => {
  describe('parse', () => {
    it('should parse valid CSV with headers', () => {
      const csv = `original,replacement,isRegex
hello,hi,false
"Doctor","Dr.",true`;

      const result = LexiconCSV.parse(csv);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ original: 'hello', replacement: 'hi', isRegex: false, applyBeforeGlobal: false });
      expect(result[1]).toEqual({ original: 'Doctor', replacement: 'Dr.', isRegex: true, applyBeforeGlobal: false });
    });

    it('should handle commas inside quotes', () => {
      const csv = `original,replacement,isRegex
"Hello, World",Hi,false
key,"value, with, commas",true`;

      const result = LexiconCSV.parse(csv);
      expect(result).toHaveLength(2);
      expect(result[0].original).toBe('Hello, World');
      expect(result[1].replacement).toBe('value, with, commas');
    });

    it('should handle escaped quotes', () => {
      const csv = `original,replacement,isRegex
"He said ""hello""",greeting,false`;

      const result = LexiconCSV.parse(csv);
      expect(result[0].original).toBe('He said "hello"');
    });

    it('should handle boolean values correctly', () => {
      const csv = `original,replacement,isRegex
a,b,true
c,d,TRUE
e,f,1
g,h,false
i,j,0
k,l,`; // empty implies false

      const result = LexiconCSV.parse(csv);
      expect(result[0].isRegex).toBe(true);
      expect(result[1].isRegex).toBe(true);
      expect(result[2].isRegex).toBe(true);
      expect(result[3].isRegex).toBe(false);
      expect(result[4].isRegex).toBe(false);
      expect(result[5].isRegex).toBe(false);
    });

    it('should ignore empty lines', () => {
      const csv = `original,replacement,isRegex
a,b,false

c,d,true`;

      const result = LexiconCSV.parse(csv);
      expect(result).toHaveLength(2);
    });

    it('should return empty array for header only', () => {
        const csv = `original,replacement,isRegex`;
        const result = LexiconCSV.parse(csv);
        expect(result).toEqual([]);
    });

    it('should handle missing isRegex column (default to false)', () => {
        const csv = `original,replacement
a,b`;
        const result = LexiconCSV.parse(csv);
        expect(result[0]).toEqual({ original: 'a', replacement: 'b', isRegex: false, applyBeforeGlobal: false });
    });

    it('should handle newlines inside quoted strings', () => {
        const csv = `original,replacement,isRegex
"Line 1
Line 2","Replacement",false`;
        const result = LexiconCSV.parse(csv);
        expect(result).toHaveLength(1);
        expect(result[0].original).toBe("Line 1\nLine 2");
    });

    it('should handle complex regex strings with quotes and commas', () => {
        // Escaping backslashes for JS string literal
        const csv = `original,replacement,isRegex
"(\\w+), (\\w+)","\\2 \\1",true
"Dr\\. ""Who""","The Doctor",false`;
        const result = LexiconCSV.parse(csv);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ original: '(\\w+), (\\w+)', replacement: '\\2 \\1', isRegex: true, applyBeforeGlobal: false });
        expect(result[1]).toEqual({ original: 'Dr\\. "Who"', replacement: 'The Doctor', isRegex: false, applyBeforeGlobal: false });
    });

    it('should handle a suite of complex REGEX strings', () => {
        const suite = [
            // Lookbehind and lookahead
            { original: '(?<=Mr\\.)\\s+Smith', replacement: ' Jones', isRegex: true },
            // Groups and backreferences
            { original: '(foo)(bar)', replacement: '$2$1', isRegex: true },
            // Escaped special characters
            { original: '\\d{4}-\\d{2}-\\d{2}', replacement: '[DATE]', isRegex: true },
            // Quotes inside regex
            { original: 'text with "quotes"', replacement: 'clean text', isRegex: false },
            // Quotes inside regex (actual regex)
            { original: 'attr="([^"]+)"', replacement: 'value=$1', isRegex: true },
            // Newlines in pattern
            { original: 'Start\\nEnd', replacement: 'SingleLine', isRegex: true }
        ];

        const csv = LexiconCSV.generate(suite as LexiconRule[]);
        const parsed = LexiconCSV.parse(csv);

        expect(parsed).toHaveLength(suite.length);
        parsed.forEach((rule, i) => {
            expect(rule.original).toBe(suite[i].original);
            expect(rule.replacement).toBe(suite[i].replacement);
            expect(rule.isRegex).toBe(suite[i].isRegex);
        });
    });
  });

  describe('generate', () => {
    it('should generate CSV with headers', () => {
      const rules: LexiconRule[] = [
        { id: '1', original: 'hello', replacement: 'hi', isRegex: false, created: 0 },
        { id: '2', original: 'Dr.', replacement: 'Doctor', isRegex: true, created: 0 }
      ];

      const csv = LexiconCSV.generate(rules);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('original,replacement,isRegex,applyBeforeGlobal');
      expect(lines[1]).toBe('"hello","hi",false,false');
      expect(lines[2]).toBe('"Dr.","Doctor",true,false');
    });

    it('should escape quotes in values', () => {
       const rules: LexiconRule[] = [
        { id: '1', original: 'He said "Hello"', replacement: 'Greeting', isRegex: false, created: 0 }
      ];

      const csv = LexiconCSV.generate(rules);
      // Expected: "He said ""Hello""","Greeting",false,false
      expect(csv).toContain('"He said ""Hello""","Greeting",false,false');
    });

    it('should handle newlines in generated CSV', () => {
        const rules: LexiconRule[] = [
            { id: '1', original: 'Line 1\nLine 2', replacement: 'R', isRegex: false, created: 0 }
        ];
        const csv = LexiconCSV.generate(rules);
        // Note: The new parser/generator might handle this differently, but for now we expect a single string containing the newline
        expect(csv).toContain('"Line 1\nLine 2","R",false,false');
    });
  });
});

describe('SimpleListCSV', () => {
    describe('parse', () => {
        it('should parse list correctly', () => {
            const csv = `Header
item1
item2`;
            const result = SimpleListCSV.parse(csv, 'Header');
            expect(result).toEqual(['item1', 'item2']);
        });

        it('should handle case-insensitive header', () => {
            const csv = `header
item1`;
            const result = SimpleListCSV.parse(csv, 'Header');
            expect(result).toEqual(['item1']);
        });

        it('should return all lines if header mismatch (treat as no header)', () => {
             const csv = `SomethingElse
item1`;
             // If header provided doesn't match, it assumes first line is data?
             // Logic: lines.shift() ONLY IF matches.
             const result = SimpleListCSV.parse(csv, 'Header');
             expect(result).toEqual(['SomethingElse', 'item1']);
        });

        it('should filter empty lines', () => {
            const csv = `Header
item1

item2`;
            const result = SimpleListCSV.parse(csv, 'Header');
            expect(result).toEqual(['item1', 'item2']);
        });
    });

    describe('generate', () => {
        it('should generate list with header', () => {
            const items = ['a', 'b'];
            const csv = SimpleListCSV.generate(items, 'Header');
            expect(csv).toBe('Header\na\nb');
        });
    });
});
