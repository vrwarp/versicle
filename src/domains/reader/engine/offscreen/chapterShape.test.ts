/**
 * `chapterShape` — spine normalization, the chapter-title fallback chain
 * and the extraction loop's yield rule.
 */
import { describe, it, expect } from 'vitest';
import {
  collectSpineItems,
  deriveChapterTitle,
  shouldYieldToMainThread,
  MAX_CHAPTER_TITLE_LENGTH,
  YIELD_AFTER_MS,
} from './chapterShape';

const docFrom = (html: string): Document =>
  new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');

describe('collectSpineItems', () => {
  it('walks an `each`-style spine in order', () => {
    const items = [{ href: 'a.html' }, { href: 'b.html' }, { href: 'c.html' }];
    const spine = { each: (cb: (i: { href: string }) => void) => items.forEach(cb) };

    expect(collectSpineItems(spine)).toEqual(items);
  });

  it('reads a plain `items` array when there is no walker', () => {
    const items = [{ href: 'a.html' }, { href: 'b.html' }];

    expect(collectSpineItems({ items })).toEqual(items);
  });

  it('copies the array rather than aliasing it', () => {
    const items = [{ href: 'a.html' }];

    const collected = collectSpineItems({ items });
    items.push({ href: 'late.html' });

    expect(collected).toHaveLength(1);
  });

  it('prefers the walker when a spine somehow offers BOTH', () => {
    const spine = {
      each: (cb: (i: { href: string }) => void) => cb({ href: 'from-each.html' }),
      items: [{ href: 'from-items.html' }],
    };

    expect(collectSpineItems(spine)).toEqual([{ href: 'from-each.html' }]);
  });

  it('yields an empty list for an empty, absent or shapeless spine', () => {
    expect(collectSpineItems({ items: [] })).toEqual([]);
    expect(collectSpineItems({})).toEqual([]);
    expect(collectSpineItems(null)).toEqual([]);
    expect(collectSpineItems(undefined)).toEqual([]);
  });
});

describe('deriveChapterTitle — the fallback chain', () => {
  it('prefers the FIRST heading, whatever its level', () => {
    const doc = docFrom('<h2>Second Level</h2><h1>Later Top Level</h1><p>Body</p>');

    expect(deriveChapterTitle(doc, 'body text', 0)).toBe('Second Level');
  });

  it('falls through a blank heading to the first paragraph', () => {
    const doc = docFrom('<h1>   </h1><p>The opening line.</p>');

    expect(deriveChapterTitle(doc, 'body text', 0)).toBe('The opening line.');
  });

  it('falls through a blank paragraph to the whole chapter text', () => {
    const doc = docFrom('<h1></h1><p>  </p>');

    expect(deriveChapterTitle(doc, 'everything in the body', 0)).toBe('everything in the body');
  });

  it('uses the chapter text directly when there is no heading and no paragraph', () => {
    const doc = docFrom('<div>not a paragraph</div>');

    expect(deriveChapterTitle(doc, 'body says this', 3)).toBe('body says this');
  });

  it('falls back to a 1-BASED positional name when the document is empty', () => {
    expect(deriveChapterTitle(docFrom(''), '', 0)).toBe('Chapter 1');
    expect(deriveChapterTitle(docFrom(''), '   ', 4)).toBe('Chapter 5');
  });

  it('collapses every run of whitespace, newlines included', () => {
    const doc = docFrom('<h1>  A \n\t  long   title  </h1>');

    expect(deriveChapterTitle(doc, '', 0)).toBe('A long title');
  });

  it('truncates an over-long title and marks it with an ellipsis', () => {
    const long = 'x'.repeat(MAX_CHAPTER_TITLE_LENGTH + 20);
    const doc = docFrom(`<h1>${long}</h1>`);

    const title = deriveChapterTitle(doc, '', 0);

    expect(title).toBe('x'.repeat(MAX_CHAPTER_TITLE_LENGTH) + '...');
    expect(title).toHaveLength(MAX_CHAPTER_TITLE_LENGTH + 3);
  });

  it('leaves a title of exactly the limit untouched', () => {
    const exact = 'y'.repeat(MAX_CHAPTER_TITLE_LENGTH);
    const doc = docFrom(`<h1>${exact}</h1>`);

    expect(deriveChapterTitle(doc, '', 0)).toBe(exact);
  });

  it('truncates AFTER collapsing whitespace, not before', () => {
    const doc = docFrom(`<h1>${'a '.repeat(50)}</h1>`);

    // 100 chars of "a " collapse to 99 ("a a a ... a"), still over the limit.
    const title = deriveChapterTitle(doc, '', 0);
    expect(title.endsWith('...')).toBe(true);
    expect(title).not.toContain('  ');
  });

  it('collapses the body-text fallback too', () => {
    expect(deriveChapterTitle(docFrom(''), '  spread \n out  ', 0)).toBe('spread out');
  });
});

describe('shouldYieldToMainThread', () => {
  it('yields only once the frame budget is EXCEEDED', () => {
    expect(shouldYieldToMainThread(0, YIELD_AFTER_MS + 0.5)).toBe(true);
    expect(shouldYieldToMainThread(0, YIELD_AFTER_MS)).toBe(false);
    expect(shouldYieldToMainThread(0, YIELD_AFTER_MS - 0.5)).toBe(false);
  });

  it('measures the elapsed span, not the absolute clock', () => {
    expect(shouldYieldToMainThread(1_000_000, 1_000_000 + YIELD_AFTER_MS + 1)).toBe(true);
    expect(shouldYieldToMainThread(1_000_000, 1_000_001)).toBe(false);
  });
});
