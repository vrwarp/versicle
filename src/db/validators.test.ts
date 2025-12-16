import { describe, it, expect, vi } from 'vitest';
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

    it('robustly sanitizes tricky HTML payloads (using DOMParser)', () => {
      // Nested tags: DOMParser parses as Text "<" followed by Script element
      // Script element is removed, leaving "<"
      expect(sanitizeString('<<script>script>alert(1)</script>')).toBe('<');

      // Attribute injection that bypassed regex: DOMParser handles quotes correctly
      expect(sanitizeString('<a title=">">Link</a>')).toBe('Link');

      // Complex image tag: Text "<" followed by Img element
      expect(sanitizeString('<<img src=x onerror=alert(1)>')).toBe('<');

      // Script with whitespace: Script element removed
      expect(sanitizeString('<script >alert(1)</script >')).toBe('');

      // Style tag removal: Style element removed
      expect(sanitizeString('<style>body{color:red}</style>')).toBe('');
    });

    it('uses safe fallback (escaping) if DOMParser is missing', () => {
        // Mock DOMParser to be undefined
        const originalDOMParser = global.DOMParser;
        vi.stubGlobal('DOMParser', undefined);

        try {
            const input = '<b>Title</b> <script>alert(1)</script>';
            const result = sanitizeString(input);

            // Expect safe escaping instead of vulnerable regex stripping
            expect(result).toBe('&lt;b&gt;Title&lt;/b&gt; &lt;script&gt;alert(1)&lt;/script&gt;');
        } finally {
            // Restore
            vi.stubGlobal('DOMParser', originalDOMParser);
        }
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

          // New behavior: content of script tags is removed
          expect(result?.sanitized.description).toBe('');

          expect(result?.modifications[0]).toContain('Title sanitized');
      });

      it('returns null for invalid structure', () => {
          expect(getSanitizedBookMetadata(null)).toBeNull();
          expect(getSanitizedBookMetadata({})).toBeNull();
      });
  });
});
