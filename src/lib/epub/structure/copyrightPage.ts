/**
 * Title/author fallback read from a book's copyright page — for packages
 * whose OPF carries no `dc:creator` and/or a file-name `dc:title` (the
 * InDesign → Sigil exports that ship `Reasonable Faith.501159.int` and no
 * creator at all), while the copyright page still says who wrote it.
 *
 * Three signals, strongest first:
 *  - the Library of Congress CIP block: `Title : subtitle / Author.—3rd ed.`
 *    (statement of responsibility) and the `Last, First.` main entry;
 *  - the copyright notice: `Copyright © 1984, 2008 by Author` (rejected
 *    when the holder is evidently an organization, e.g. a publisher);
 *  - for the title only, the page's first line when the notice follows it.
 *
 * Pure: callers hand in parsed documents (see `resolveStructureCopyright`).
 */

export interface CopyrightMetadata {
  title?: string;
  author?: string;
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'blockquote', 'li', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'td', 'th', 'table', 'ul', 'ol', 'dl', 'pre', 'address', 'figure', 'figcaption',
]);

/** A content document's visible text as trimmed, non-empty lines (block elements and `<br>` break). */
export function pageLines(doc: Document): string[] {
  const root = doc.getElementsByTagName('body')[0] ?? doc.documentElement;
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      // Source-markup newlines are whitespace; only blocks and <br> break lines.
      parts.push((node.nodeValue ?? '').replace(/\s+/g, ' '));
      return;
    }
    if (node.nodeType !== 1) return;
    const name = (node as Element).localName.toLowerCase();
    if (name === 'script' || name === 'style') return;
    if (name === 'br') {
      parts.push('\n');
      return;
    }
    const block = BLOCK_TAGS.has(name);
    if (block) parts.push('\n');
    node.childNodes.forEach(walk);
    if (block) parts.push('\n');
  };
  if (root) walk(root);
  return parts
    .join('')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Cheap pre-check on raw markup before parsing a document. */
export function mayBeCopyrightPage(text: string): boolean {
  return /copyright|©|&copy;|&#169;|&#xa9;/i.test(text);
}

const ORGANIZATION =
  /\b(inc|llc|l\.l\.c|ltd|limited|corp|corporation|company|co|plc|gmbh|press|publish\w*|publications?|books?|house|media|group|ministr\w*|foundation|society|university|college|trust|estate|editions?|verlag|bible|church|association|council|institute|studios?|entertainment|holdings|enterprises|international)\b/i;

/** Plausible personal name(s): 1–12 words, letters, no digits or organization words. */
function personLike(name: string): boolean {
  if (!name || name.length > 120 || /\d/.test(name) || ORGANIZATION.test(name)) return false;
  if (!/\p{Lu}/u.test(name)) return false;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 12;
}

function cleanName(raw: string): string {
  return raw
    .replace(/\s*\[?\bet al\.?\]?\s*$/i, '')
    .replace(/[\s.,;:]+$/, '')
    .trim();
}

/** `Craig, William Lane, 1949-` → `William Lane Craig`. */
function invertMainEntry(line: string): string | undefined {
  if (/[:/]/.test(line)) return undefined;
  const m = /^([^,]+),\s*([^,]+?)(?:,\s*(?:\d{4}\s*-\s*(?:\d{4})?|\d{4}-?))?\.?$/.exec(line);
  if (!m) return undefined;
  const name = cleanName(`${m[2]} ${m[1]}`);
  return personLike(name) ? name : undefined;
}

/** `Title : subtitle / by Author.—3rd ed.` → title and responsibility. */
function parseTitleStatement(line: string): CopyrightMetadata {
  const slash = line.indexOf(' / ');
  if (slash <= 0) return {};
  const title = line
    .slice(0, slash)
    .replace(/\s+:\s*/g, ': ')
    .replace(/[\s.]+$/, '')
    .trim();
  let responsibility = line.slice(slash + 3).split(/\s*[—–;]\s*|\s+--?\s+|\.\s*-\s*/)[0] ?? '';
  responsibility = responsibility.replace(/^(?:written\s+)?by\s+/i, '');
  const out: CopyrightMetadata = {};
  if (title) out.title = title;
  if (!/^(?:edited|compiled|translated|selected|illustrated)\b/i.test(responsibility)) {
    const author = cleanName(responsibility);
    if (personLike(author)) out.author = author;
  }
  return out;
}

const NOTICE = /(?:copyright|©|\(c\))/i;
const HOLDER =
  /^.*?(?:copyright|©|\(c\))(?:\s*(?:©|\(c\)))*\s*(?:\d{4}(?:\s*(?:,|-|–|and|&)\s*\d{4})*\s*,?\s*)?(?:by\s+)?(.+)$/i;

function noticeHolder(line: string): string | undefined {
  const m = HOLDER.exec(line);
  if (!m) return undefined;
  const holder = cleanName(m[1].split(/\.?\s*all rights reserved/i)[0]);
  // A one-word holder is almost always an imprint (`© 2008 Crossway`).
  return personLike(holder) && holder.includes(' ') ? holder : undefined;
}

const normalizeTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s*:\s*/g, ':')
    .replace(/[\s.]+$/, '')
    .replace(/\s+/g, ' ');

/** Pull title/author out of a copyright page's lines (see module doc). */
export function parseCopyrightLines(lines: readonly string[]): CopyrightMetadata {
  // The first notice line, skipping a bare `Copyright` heading.
  const noticeAt = lines.findIndex((l) => NOTICE.test(l) && !/^copyright(?:\s+page)?$/i.test(l));
  if (noticeAt < 0) return {};

  let cipTitle: string | undefined;
  let author: string | undefined;
  const cipAt = lines.findIndex((l) => /cataloging[\s-]*in[\s-]*publication/i.test(l));
  if (cipAt >= 0) {
    const block = lines.slice(cipAt + 1, cipAt + 8);
    const statement = block.map(parseTitleStatement).find((s) => s.title);
    cipTitle = statement?.title;
    author = statement?.author ?? (block[0] ? invertMainEntry(block[0]) : undefined);
  }
  author ??= noticeHolder(lines[noticeAt]);

  let title: string | undefined;
  if (cipTitle) {
    // The CIP title is sentence-cased; prefer the page's own casing of it.
    const want = normalizeTitle(cipTitle);
    title = lines.slice(0, noticeAt).find((l) => normalizeTitle(l) === want) ?? cipTitle;
  } else if (noticeAt === 1 && lines[0].length <= 200 && !NOTICE.test(lines[0])) {
    title = lines[0];
  }

  const out: CopyrightMetadata = {};
  if (title) out.title = title;
  if (author) out.author = author;
  return out;
}

/**
 * An OPF title that is really a file or job name (`Reasonable Faith.501159.int`,
 * `Book_Interior_v3.indd`) or a placeholder — worth replacing when the
 * copyright page offers one.
 */
export function isPlaceholderTitle(title: string | undefined): boolean {
  const t = title?.trim() ?? '';
  if (!t || /^(?:untitled|unknown|title)$/i.test(t)) return true;
  return (
    /\.(?:x?html?|xml|indd|idml|int|docx?|rtf|pdf|epub|txt|qxd)$/i.test(t) ||
    /\.\d{3,}(?:\.|$)/.test(t) ||
    (/_/.test(t) && !/\s/.test(t))
  );
}
