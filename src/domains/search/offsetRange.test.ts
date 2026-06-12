/**
 * Offset→Range mapping for exact-occurrence navigation (Phase 7 §F). The
 * corpus is textContent in document order, so offsets must resolve across
 * element boundaries and inside nested markup.
 */
import { describe, it, expect } from 'vitest';
import { findRangeForOffset, resolveResultCfi } from './offsetRange';
import type { DetailedSearchResult } from '~types/search';

function makeDoc(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('findRangeForOffset', () => {
  it('resolves an offset inside a single text node', () => {
    const root = makeDoc('<p>Call me Ishmael.</p>');
    const text = root.textContent!;
    const offset = text.indexOf('Ishmael');

    const range = findRangeForOffset(root, offset, 'Ishmael'.length);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('Ishmael');
  });

  it('resolves a match spanning element boundaries', () => {
    const root = makeDoc('<p>white <em>wha</em>le swam</p>');
    const text = root.textContent!; // "white whale swam"
    const offset = text.indexOf('whale');

    const range = findRangeForOffset(root, offset, 'whale'.length);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('whale');
  });

  it('resolves matches in later siblings (accumulated lengths)', () => {
    const root = makeDoc('<p>one</p><p>two</p><p>three target three</p>');
    const text = root.textContent!; // "onetwothree target three"
    const offset = text.indexOf('target');

    const range = findRangeForOffset(root, offset, 'target'.length);
    expect(range!.toString()).toBe('target');
  });

  it('returns null for offsets beyond the document text', () => {
    const root = makeDoc('<p>short</p>');
    expect(findRangeForOffset(root, 100, 5)).toBeNull();
    expect(findRangeForOffset(root, -1, 5)).toBeNull();
    expect(findRangeForOffset(root, 0, 0)).toBeNull();
  });
});

describe('resolveResultCfi', () => {
  const result: DetailedSearchResult = {
    href: 'ch1.xhtml',
    excerpt: '…',
    charOffset: 8,
    matchLength: 7,
    occurrence: 1,
  };

  it('populates cfi via the INJECTED generator (no epubjs import here)', () => {
    const root = makeDoc('<p>Call me Ishmael.</p>');
    const resolved = resolveResultCfi(result, root, (range) => `cfi-for:${range.toString()}`);
    expect(resolved.cfi).toBe('cfi-for:Ishmael');
    // Original result untouched (pure).
    expect(result.cfi).toBeUndefined();
  });

  it('degrades to the unchanged result when resolution fails (display(href) fallback)', () => {
    const root = makeDoc('<p>tiny</p>');
    expect(resolveResultCfi(result, root, () => 'never')).toBe(result);

    const okRoot = makeDoc('<p>Call me Ishmael.</p>');
    expect(resolveResultCfi(result, okRoot, () => null)).toBe(result);
    expect(
      resolveResultCfi(result, okRoot, () => {
        throw new Error('cfi blew up');
      }),
    ).toBe(result);
  });
});
