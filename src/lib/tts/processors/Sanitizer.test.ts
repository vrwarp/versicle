import { describe, it, expect } from 'vitest';
import { Sanitizer } from './Sanitizer';

describe('Sanitizer', () => {
  it('should remove standalone page numbers', () => {
    expect(Sanitizer.sanitize('Page 12')).toBe('');
    expect(Sanitizer.sanitize('pg 4')).toBe('');
    expect(Sanitizer.sanitize('15')).toBe('');
    expect(Sanitizer.sanitize('  23  ')).toBe('');
    expect(Sanitizer.sanitize('Not a page number')).toBe('Not a page number');
  });

  it('should replace URLs with domains', () => {
    // Basic test
    expect(Sanitizer.sanitize('Visit https://google.com for info')).toBe('Visit google.com for info');

    // Test from plan
    expect(Sanitizer.sanitize('You can find the sermons at https://old.thecrossing.website/sermons.')).toBe('You can find the sermons at old.thecrossing.website.');

    // Multiple URLs
    expect(Sanitizer.sanitize('Links: http://example.org/a and https://test.co.uk/b')).toBe('Links: example.org and test.co.uk');
  });

  it('should remove citations', () => {
    // Numeric
    expect(Sanitizer.sanitize('This is a fact [1].')).toBe('This is a fact .');
    expect(Sanitizer.sanitize('Multi citation [1, 2, 3]')).toBe('Multi citation');

    // Author-Year
    expect(Sanitizer.sanitize('According to (Smith, 2020), this is true.')).toBe('According to , this is true.');
    expect(Sanitizer.sanitize('Another study (Jones 2021:24) showed...')).toBe('Another study showed...');
  });

  it('should handle visual separators', () => {
    expect(Sanitizer.sanitize('***')).toBe('');
    expect(Sanitizer.sanitize('---')).toBe('');
    expect(Sanitizer.sanitize('  ___  ')).toBe('');
    expect(Sanitizer.sanitize('This is *** not a separator')).toBe('This is *** not a separator');
  });

  it('should clean up extra spaces', () => {
     expect(Sanitizer.sanitize('Text with [1] removed citation')).toBe('Text with removed citation');
     expect(Sanitizer.sanitize('Text  with   multiple spaces')).toBe('Text with multiple spaces');
  });

  it('should handle complex mixed cases', () => {
      // The sanitizer is designed to work primarily on sentence/block level segments.
      // 1. Standalone page number -> empty
      expect(Sanitizer.sanitize('Page 42')).toBe('');

      // 2. Text with artifacts
      const input = 'See https://wikipedia.org for details [1].';
      expect(Sanitizer.sanitize(input)).toBe('See wikipedia.org for details .');
  });
});
