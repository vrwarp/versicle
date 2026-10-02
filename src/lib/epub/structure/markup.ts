/**
 * Lenient XML/XHTML parsing for package documents.
 *
 * Real-world EPUBs regularly ship XHTML that is not well-formed XML (stray
 * `&nbsp;`, unclosed `<br>`), which the strict XML parser turns into a
 * `<parsererror>` document. Falling back to the HTML parser keeps the
 * element tree usable for the reads done here (links, images, attributes).
 */

function hasParserError(doc: Document): boolean {
  return doc.getElementsByTagName('parsererror').length > 0;
}

/** Parse XML-ish text (OPF, NCX, nav, content XHTML); HTML parser on failure. */
export function parseMarkup(text: string, type: 'application/xml' | 'application/xhtml+xml' = 'application/xml'): Document {
  const parser = new DOMParser();
  const strict = parser.parseFromString(text, type);
  if (!hasParserError(strict)) return strict;
  return parser.parseFromString(text, 'text/html');
}

/** Elements by local name, ignoring namespaces and prefixes. */
export function byLocalName(root: Document | Element, localName: string): Element[] {
  const hits = Array.from(root.getElementsByTagNameNS('*', localName));
  if (hits.length > 0) return hits;
  // The HTML-parser fallback keeps prefixes in the tag name (`opf:item`).
  const lower = localName.toLowerCase();
  return Array.from(root.getElementsByTagName('*')).filter((el) => {
    const name = el.localName.toLowerCase();
    return name === lower || name.endsWith(`:${lower}`);
  });
}

/** `epub:type` (any prefix/namespace) split into tokens. */
export function epubTypes(el: Element): string[] {
  const direct =
    el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ??
    el.getAttribute('epub:type') ??
    '';
  return direct.split(/\s+/).filter(Boolean);
}

/** `href` or `xlink:href`, whichever an element carries. */
export function linkTarget(el: Element): string | null {
  return (
    el.getAttribute('href') ??
    el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
    el.getAttribute('xlink:href')
  );
}
