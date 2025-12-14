import { describe, it, expect } from 'vitest';
import { sanitizeString, sanitizeBookMetadata } from './validators';
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

  describe('sanitizeBookMetadata', () => {
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
          const result = sanitizeBookMetadata(input);
          expect(result).not.toBeNull();
          expect(result?.title).toBe('Title');
          expect(result?.author).toBe('Author');
          expect(result?.description).toBe('Desc');
      });

      it('truncates overly long fields', () => {
          const longString = 'a'.repeat(3000);
          const input = {
              ...validBook,
              title: longString,
              author: longString,
              description: longString
          };
          const result = sanitizeBookMetadata(input);
          expect(result).not.toBeNull();
          expect(result?.title.length).toBe(500);
          expect(result?.author.length).toBe(255);
          expect(result?.description?.length).toBe(2000);
      });

      it('returns null for invalid structure', () => {
          expect(sanitizeBookMetadata(null)).toBeNull();
          expect(sanitizeBookMetadata({})).toBeNull();
      });
  });
});
