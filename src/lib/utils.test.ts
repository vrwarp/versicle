import { describe, it, expect } from 'vitest';
import { cn, formatToastBookTitle } from './utils';

describe('utils', () => {
  it('should merge class names', () => {
    expect(cn('c1', 'c2')).toBe('c1 c2');
  });

  it('should handle conditional classes', () => {
    const isTrue = true;
    const isFalse = false;
    expect(cn('c1', isTrue ? 'c2' : '', isFalse ? 'c3' : '')).toBe('c1 c2');
  });

  it('should handle arrays', () => {
    expect(cn(['c1', 'c2'])).toBe('c1 c2');
  });

  it('should handle objects', () => {
    expect(cn({ c1: true, c2: false })).toBe('c1');
  });

  it('should handle tailwind conflicts', () => {
      // clsx + tailwind-merge behavior
      expect(cn('px-2 py-1', 'p-4')).toBe('p-4');
  });

  it('should handle mixed inputs', () => {
      expect(cn('c1', undefined, null, 'c2')).toBe('c1 c2');
  });

  describe('formatToastBookTitle', () => {
    it('prefers a resolved book title over the raw filename', () => {
      expect(formatToastBookTitle('pg11-images-3.epub', "Alice's Adventures in Wonderland")).toBe(
        "Alice's Adventures in Wonderland",
      );
    });

    it('falls back to the filename stripped of .epub when title is blank or missing', () => {
      expect(formatToastBookTitle('my-book.EPUB', '   ')).toBe('my-book');
      expect(formatToastBookTitle('plain-name', undefined)).toBe('plain-name');
    });
  });
});
