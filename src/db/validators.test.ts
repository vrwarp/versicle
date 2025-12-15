import { describe, it, expect } from 'vitest';
import { sanitizeString, getSanitizedBookMetadata } from './validators';
import type { BookMetadata } from '../types/db';

describe('validators', () => {
  describe('sanitizeString', () => {
    it('trims whitespace', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
    });

    it('truncates to max length', () => {
      expect(sanitizeString('hello world', 5)).toBe('hello');
    });

    it('returns empty string for non-string input', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(sanitizeString(123 as any)).toBe('');
    });
  });

  describe('getSanitizedBookMetadata', () => {
      const validBook: BookMetadata = {
          id: '123',
          title: 'Title',
          author: 'Author',
          addedAt: 1234567890
      };

      it('sanitizes string fields', () => {
          const input = {
              ...validBook,
              title: '  Title  ',
              author: '  Author  ',
              description: '  Desc  '
          };
          const result = getSanitizedBookMetadata(input);
          expect(result).not.toBeNull();
          expect(result?.wasModified).toBe(true);
          expect(result?.sanitized.title).toBe('Title');
          expect(result?.sanitized.author).toBe('Author');
          expect(result?.sanitized.description).toBe('Desc');
      });

      it('detects modifications (trimming)', () => {
          const input = {
              ...validBook,
              title: '  Title  '
          };
          const result = getSanitizedBookMetadata(input);
          expect(result?.wasModified).toBe(true);
          expect(result?.sanitized.title).toBe('Title');
      });

      it('truncates overly long fields and reports it', () => {
          const longString = 'a'.repeat(3000);
          const input = {
              ...validBook,
              title: longString,
              author: longString,
              description: longString
          };
          const result = getSanitizedBookMetadata(input);
          expect(result).not.toBeNull();
          expect(result?.wasModified).toBe(true);

          expect(result?.sanitized.title.length).toBe(500);
          expect(result?.sanitized.author.length).toBe(255);
          expect(result?.sanitized.description?.length).toBe(2000);

          expect(result?.modifications).toHaveLength(3);
          // Check for new message format
          expect(result?.modifications[0]).toContain('Title sanitized');
      });

      it('strips HTML tags but preserves math symbols', () => {
          const input = {
              ...validBook,
              title: '<b>Title</b>',
              author: 'A < B',
              description: '<script>alert(1)</script>'
          };
          const result = getSanitizedBookMetadata(input);
          expect(result?.wasModified).toBe(true);
          expect(result?.sanitized.title).toBe('Title');
          expect(result?.sanitized.author).toBe('A < B'); // Preserved
          expect(result?.sanitized.description).toBe('alert(1)');

          expect(result?.modifications[0]).toContain('Title sanitized');
      });

      it('returns null for invalid structure', () => {
          expect(getSanitizedBookMetadata(null)).toBeNull();
          expect(getSanitizedBookMetadata({})).toBeNull();
      });
  });
});
