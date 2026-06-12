import { describe, it, expect } from 'vitest';
import { matchPaths, findTocItem, resolveSyntheticPreference } from './titleResolver';
import type { NavigationItem } from '~types/book';
import type { UserInventoryItem } from '~types/user-data';

describe('titleResolver', () => {
  describe('matchPaths', () => {
    it('returns false if either path is nullish or empty', () => {
      expect(matchPaths(null, 'chapter1.html')).toBe(false);
      expect(matchPaths('chapter1.html', undefined)).toBe(false);
      expect(matchPaths('', '')).toBe(false);
    });

    it('matches identical paths exactly', () => {
      expect(matchPaths('chapter1.html', 'chapter1.html')).toBe(true);
    });

    it('matches case-insensitively', () => {
      expect(matchPaths('Chapter1.HTML', 'chapter1.html')).toBe(true);
    });

    it('strips hash anchors before comparing', () => {
      expect(matchPaths('chapter1.html#section1', 'chapter1.html#section2')).toBe(true);
      expect(matchPaths('CHAPTER1.HTML#section1', 'chapter1.html')).toBe(true);
    });

    it('handles relative folder prefixes matching endsWith correctly', () => {
      expect(matchPaths('OEBPS/chapter1.html', 'chapter1.html')).toBe(true);
      expect(matchPaths('chapter1.html', 'OEBPS/chapter1.html')).toBe(true);
      expect(matchPaths('OEBPS/text/chapter1.html', 'chapter1.html')).toBe(true);
    });

    it('does not false match partial path suffixes', () => {
      expect(matchPaths('my-chapter1.html', 'chapter1.html')).toBe(false);
      expect(matchPaths('chapter1.html', 'not-chapter1.html')).toBe(false);
    });
  });

  describe('findTocItem', () => {
    const mockToc: NavigationItem[] = [
      {
        id: 'toc-1',
        href: 'OEBPS/chapter1.xhtml',
        label: 'Chapter 1',
        subitems: [
          {
            id: 'toc-1-1',
            href: 'OEBPS/chapter1_1.xhtml#sub',
            label: 'Section 1.1',
            subitems: []
          }
        ]
      },
      {
        id: 'toc-2',
        href: 'OEBPS/chapter2.xhtml',
        label: 'Chapter 2',
        subitems: []
      }
    ];

    it('returns null if key is nullish or empty', () => {
      expect(findTocItem(mockToc, null)).toBeNull();
      expect(findTocItem(mockToc, undefined)).toBeNull();
      expect(findTocItem(mockToc, '')).toBeNull();
    });

    it('performs exact first-pass match on href', () => {
      const result = findTocItem(mockToc, 'OEBPS/chapter2.xhtml');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('toc-2');
      expect(result?.label).toBe('Chapter 2');
    });

    it('performs exact first-pass match on id', () => {
      const result = findTocItem(mockToc, 'toc-2');
      expect(result).not.toBeNull();
      expect(result?.label).toBe('Chapter 2');
    });

    it('recursively searches exact match in subitems', () => {
      const result = findTocItem(mockToc, 'OEBPS/chapter1_1.xhtml#sub');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('toc-1-1');
      expect(result?.label).toBe('Section 1.1');
    });

    it('falls back to path-only comparison (second pass)', () => {
      // Different folder prefixes and anchor stripped
      const result = findTocItem(mockToc, 'chapter1_1.xhtml');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('toc-1-1');
    });

    it('returns null if no matches are found', () => {
      expect(findTocItem(mockToc, 'chapter3.xhtml')).toBeNull();
    });
  });

  describe('resolveSyntheticPreference', () => {
    it('returns false if book is nullish', () => {
      expect(resolveSyntheticPreference(null)).toBe(false);
      expect(resolveSyntheticPreference(undefined)).toBe(false);
    });

    it('respects explicit useSyntheticToc preference if defined', () => {
      const bookTrue: Partial<UserInventoryItem> = { useSyntheticToc: true };
      expect(resolveSyntheticPreference(bookTrue as UserInventoryItem)).toBe(true);

      const bookFalse: Partial<UserInventoryItem> = { useSyntheticToc: false };
      expect(resolveSyntheticPreference(bookFalse as UserInventoryItem)).toBe(false);
    });

    it('falls back to true if useSyntheticToc is undefined and syntheticToc contains items', () => {
      // syntheticToc is not part of UserInventoryItem; the resolver reads it
      // dynamically off whatever book-shaped object it receives.
      const book: Partial<UserInventoryItem> & { syntheticToc?: unknown[] } = {
        useSyntheticToc: undefined,
        syntheticToc: [{ id: '1', label: 'AI Title', href: 'ch1.html' }]
      };
      expect(resolveSyntheticPreference(book)).toBe(true);
    });

    it('falls back to false if useSyntheticToc is undefined and syntheticToc is empty or missing', () => {
      const bookEmpty: Partial<UserInventoryItem> & { syntheticToc?: unknown[] } = {
        useSyntheticToc: undefined,
        syntheticToc: []
      };
      expect(resolveSyntheticPreference(bookEmpty)).toBe(false);

      const bookMissing: Partial<UserInventoryItem> = {
        useSyntheticToc: undefined
      };
      expect(resolveSyntheticPreference(bookMissing)).toBe(false);
    });
  });
});
