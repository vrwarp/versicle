/**
 * Parse an EPUB 3 nav document or an EPUB 2 NCX into raw TOC trees.
 *
 * Hrefs are returned exactly as written (relative to the nav/NCX file);
 * `tocResolver` maps them onto the spine. Ids follow epub.js's rules
 * (`<li id>` / `<navPoint id>`, else the href) so a tree parsed here is
 * interchangeable with `book.navigation.toc`.
 */
import type { NavigationItem } from '~types/book';
import { byLocalName, epubTypes } from './markup';

export interface Landmark {
  type: string;
  href: string;
}

export interface ParsedNav {
  toc: NavigationItem[];
  landmarks: Landmark[];
}

function cleanLabel(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function childElements(el: Element, localName: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName.toLowerCase() === localName);
}

function parseNavList(ol: Element, parent: string | undefined, seen: Set<string>): NavigationItem[] {
  const items: NavigationItem[] = [];
  for (const li of childElements(ol, 'li')) {
    const content = childElements(li, 'a')[0] ?? childElements(li, 'span')[0];
    if (!content) continue;
    const href = content.getAttribute('href') ?? '';
    let id = li.getAttribute('id') || href || `nav-${seen.size}`;
    // Duplicate ids (two entries into one file) would collide in the UI.
    if (seen.has(id)) id = `${id}~${seen.size}`;
    seen.add(id);
    const nested = childElements(li, 'ol')[0];
    const item: NavigationItem = { id, href, label: cleanLabel(content.textContent) };
    if (parent) item.parent = parent;
    const subitems = nested ? parseNavList(nested, id, seen) : [];
    if (subitems.length > 0) item.subitems = subitems;
    items.push(item);
  }
  return items;
}

/** EPUB 3 nav document → TOC + landmarks. */
export function parseNavDocument(doc: Document): ParsedNav {
  const navs = byLocalName(doc, 'nav');
  const tocNav =
    navs.find((n) => epubTypes(n).includes('toc')) ??
    navs.find((n) => {
      const types = epubTypes(n);
      return !types.includes('landmarks') && !types.includes('page-list');
    });
  const tocOl = tocNav ? childElements(tocNav, 'ol')[0] ?? byLocalName(tocNav, 'ol')[0] : undefined;
  const toc = tocOl ? parseNavList(tocOl, undefined, new Set()) : [];

  const landmarks: Landmark[] = [];
  const landmarksNav = navs.find((n) => epubTypes(n).includes('landmarks'));
  if (landmarksNav) {
    for (const a of byLocalName(landmarksNav, 'a')) {
      const href = a.getAttribute('href');
      for (const type of epubTypes(a)) {
        if (href) landmarks.push({ type: type.toLowerCase(), href });
      }
    }
  }
  return { toc, landmarks };
}

function parseNavPoints(container: Element, parent: string | undefined, seen: Set<string>): NavigationItem[] {
  const items: NavigationItem[] = [];
  for (const point of childElements(container, 'navpoint')) {
    const content = childElements(point, 'content')[0];
    const href = content?.getAttribute('src') ?? '';
    const labelEl = childElements(point, 'navlabel')[0];
    const text = labelEl ? childElements(labelEl, 'text')[0] : undefined;
    let id = point.getAttribute('id') || href || `ncx-${seen.size}`;
    if (seen.has(id)) id = `${id}~${seen.size}`;
    seen.add(id);
    const item: NavigationItem = { id, href, label: cleanLabel(text?.textContent ?? labelEl?.textContent) };
    if (parent) item.parent = parent;
    const subitems = parseNavPoints(point, id, seen);
    if (subitems.length > 0) item.subitems = subitems;
    items.push(item);
  }
  return items;
}

/** EPUB 2 NCX → TOC. */
export function parseNcxDocument(doc: Document): NavigationItem[] {
  const navMap = byLocalName(doc, 'navMap')[0] ?? byLocalName(doc, 'navmap')[0];
  return navMap ? parseNavPoints(navMap, undefined, new Set()) : [];
}
