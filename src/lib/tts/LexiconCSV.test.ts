import { describe, it, expect } from 'vitest';
import { LexiconCSV } from './CsvUtils';
import type { LexiconRule } from '../../types/db';

describe('LexiconCSV', () => {
  it('should roundtrip rules with applyBeforeGlobal', () => {
    const rules: LexiconRule[] = [
      { id: '1', original: 'Hello', replacement: 'Hi', isRegex: false, applyBeforeGlobal: true, created: 0 },
      { id: '2', original: 'World', replacement: 'Earth', isRegex: true, applyBeforeGlobal: false, created: 0 },
      { id: '3', original: 'Test', replacement: 'T', isRegex: false, created: 0 } // undefined applyBeforeGlobal
    ];

    const csv = LexiconCSV.generate(rules);

    // Header + 3 rows
    expect(csv).toContain('original,replacement,isRegex,applyBeforeGlobal');

    const parsed = LexiconCSV.parse(csv);

    expect(parsed).toHaveLength(3);

    expect(parsed[0].original).toBe('Hello');
    expect(parsed[0].applyBeforeGlobal).toBe(true);

    expect(parsed[1].original).toBe('World');
    expect(parsed[1].applyBeforeGlobal).toBe(false);

    expect(parsed[2].original).toBe('Test');
    expect(parsed[2].applyBeforeGlobal).toBe(false); // Default is false/undefined -> boolean conversion might be false
  });
});
