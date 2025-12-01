import { describe, it, expect } from 'vitest';
import { LEXICON_SAMPLE_CSV } from './lexiconSample';

describe('Lexicon Sample CSV', () => {
  it('should match the expected format', () => {
    const lines = LEXICON_SAMPLE_CSV.trim().split('\n');
    expect(lines.length).toBeGreaterThan(1); // Header + at least one row

    const header = lines[0];
    expect(header).toBe('original,replacement,isRegex');

    // Check first row
    const row1 = lines[1];
    // Simple check, not robust CSV parsing for the test unless needed
    expect(row1).toContain('"Dr."');
    expect(row1).toContain('"Doctor"');
    expect(row1).toContain('false');
  });

  it('should validly parse as CSV', () => {
    const lines = LEXICON_SAMPLE_CSV.trim().split('\n');
    const header = lines[0].split(',');

    expect(header).toEqual(['original', 'replacement', 'isRegex']);

    for (let i = 1; i < lines.length; i++) {
        // Very basic CSV split for test purposes, assuming no commas in values for the sample
        // This regex splits by comma but respects quotes
        const parts = lines[i].match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)?.map(s => s.replace(/^,/, '')) || [];
        expect(parts.length).toBe(3);
    }
  });
});
