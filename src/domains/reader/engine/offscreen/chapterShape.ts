/**
 * Shape decisions for the offscreen extraction loop — what the spine holds
 * and what a chapter is called.
 *
 * Both are pure functions of a rendered document, separated from
 * `offscreen-renderer` so they can be exercised against a plain DOM: the
 * title chain in particular is a cascade of fallbacks that only shows up in
 * the library UI, where a wrong answer is quietly wrong rather than loud.
 */

/** The subset of an epub.js spine item this pipeline reads. */
export interface SpineItemLike {
  href: string;
}

/**
 * epub.js exposes the spine either as an `each` walker or as a plain
 * `items` array depending on version and book. Normalize to an array.
 */
export function collectSpineItems<T = SpineItemLike>(spine: unknown): T[] {
  const items: T[] = [];
  const candidate = spine as
    | { each?: (cb: (item: T) => void) => void; items?: T[] }
    | null
    | undefined;
  if (!candidate) return items;

  if (candidate.each) {
    candidate.each((item) => items.push(item));
  } else if (candidate.items) {
    items.push(...candidate.items);
  }
  return items;
}

/** Longer titles are truncated (with an ellipsis) for the library list. */
export const MAX_CHAPTER_TITLE_LENGTH = 60;

/**
 * Name a chapter from its rendered document, in descending order of
 * trustworthiness: the first heading → the first paragraph → the chapter's
 * whole text → a positional fallback. Whitespace is collapsed and the
 * result truncated; a chapter whose document is empty still gets a name.
 *
 * `index` is 0-based; the positional fallback is 1-based ("Chapter 1").
 */
export function deriveChapterTitle(doc: ParentNode, bodyText: string, index: number): string {
  let title = '';

  const headings = doc.querySelectorAll('h1, h2, h3');
  if (headings.length > 0) {
    title = headings[0].textContent || '';
  }
  if (!title.trim()) {
    const p = doc.querySelector('p');
    if (p && p.textContent) title = p.textContent;
  }
  if (!title.trim()) {
    title = bodyText;
  }

  title = title.replace(/\s+/g, ' ').trim();
  if (title.length > MAX_CHAPTER_TITLE_LENGTH) {
    title = title.substring(0, MAX_CHAPTER_TITLE_LENGTH) + '...';
  }
  if (!title) title = `Chapter ${index + 1}`;

  return title;
}

/**
 * The extraction loop yields to the event loop only after it has held the
 * main thread for longer than a frame — a fixed per-chapter sleep added
 * seconds to a large book for no benefit.
 */
export const YIELD_AFTER_MS = 16;

export function shouldYieldToMainThread(lastYieldTime: number, now: number): boolean {
  return now - lastYieldTime > YIELD_AFTER_MS;
}
