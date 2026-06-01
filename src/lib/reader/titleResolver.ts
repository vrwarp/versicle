import type { NavigationItem, UserInventoryItem } from '../../types/db';

/**
 * Compares two path strings resiliently:
 * 1. Strips hash anchors.
 * 2. Case-insensitive comparison.
 * 3. Handles relative folder prefixes (e.g. 'OEBPS/chapter_01.xhtml' vs 'chapter_01.xhtml').
 */
export const matchPaths = (path1: string | undefined | null, path2: string | undefined | null): boolean => {
  if (!path1 || !path2) return false;
  const p1 = path1.split('#')[0].toLowerCase();
  const p2 = path2.split('#')[0].toLowerCase();
  return p1 === p2 || p1.endsWith('/' + p2) || p2.endsWith('/' + p1);
};

/**
 * Robust two-pass tree search for a NavigationItem inside the TOC structure:
 * Pass 1: Looks for an exact full href or id match in the tree first.
 * Pass 2: Fallback to matching paths resiliently using matchPaths.
 */
export const findTocItem = (toc: NavigationItem[], key: string | undefined | null): NavigationItem | null => {
  if (!key) return null;

  // Pass 1: Exact Match Search
  const findExact = (items: NavigationItem[]): NavigationItem | null => {
    for (const item of items) {
      if (item.href === key || item.id === key) return item;
      if (item.subitems && item.subitems.length > 0) {
        const found = findExact(item.subitems);
        if (found) return found;
      }
    }
    return null;
  };

  const exact = findExact(toc);
  if (exact) return exact;

  // Pass 2: Path-only Match Search
  const findPathOnly = (items: NavigationItem[]): NavigationItem | null => {
    for (const item of items) {
      if (matchPaths(item.href, key)) return item;
      if (item.subitems && item.subitems.length > 0) {
        const found = findPathOnly(item.subitems);
        if (found) return found;
      }
    }
    return null;
  };

  return findPathOnly(toc);
};

/**
 * Centralizes preference evaluation:
 * Returns the useSyntheticToc preference if explicitly defined,
 * otherwise defaults to true if syntheticToc items exist.
 */
export const resolveSyntheticPreference = (book: Partial<UserInventoryItem> | null | undefined): boolean => {
  if (!book) return false;
  if (book.useSyntheticToc !== undefined) {
    return book.useSyntheticToc;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const syntheticToc = (book as any).syntheticToc;
  return !!(syntheticToc && syntheticToc.length > 0);
};
