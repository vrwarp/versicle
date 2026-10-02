/**
 * Path arithmetic for EPUB package-internal references.
 *
 * Every reference inside an EPUB (manifest hrefs, nav/NCX links, `<img src>`)
 * is a URL relative to the document that contains it. epub.js only ever
 * resolves against the OPF's directory, which is what broke TOCs whose nav
 * document sits in a subfolder. These helpers are the one definition the
 * import pipeline, the live reader and the Drive range reader share.
 *
 * Conventions: paths are zip-relative or OPF-relative strings with no
 * leading slash; directories end in '/'; the empty string is the root.
 */

/** `a/b/c.xhtml` → `a/b/`; `c.xhtml` → `''`. */
export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

/** `a/b/c.xhtml#x` → `c.xhtml`. */
export function basename(path: string): string {
  const bare = splitFragment(path)[0];
  return bare.slice(bare.lastIndexOf('/') + 1);
}

/** Split `path#frag` into `[path, frag]` (fragment without the `#`). */
export function splitFragment(href: string): [string, string] {
  const i = href.indexOf('#');
  return i < 0 ? [href, ''] : [href.slice(0, i), href.slice(i + 1)];
}

/** Re-join a path and fragment (no `#` when the fragment is empty). */
export function withFragment(path: string, fragment: string): string {
  return fragment ? `${path}#${fragment}` : path;
}

/** `decodeURIComponent` that never throws on a malformed escape. */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Normalize separators and dot segments. Leading `/`, `./` and empty
 * segments are dropped; `..` above the root is clamped (lenient on purpose:
 * malformed books overshoot the root and still mean the obvious file).
 */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * Resolve `href` against the file `baseFile` (both package-relative),
 * dropping any query string and preserving the fragment. A leading `/`
 * means "from the zip root" and ignores `baseFile`. A fragment-only href
 * resolves to `baseFile` itself.
 */
export function resolveRelative(baseFile: string, href: string): string {
  const [rawPath, fragment] = splitFragment(href.trim());
  const path = rawPath.split('?')[0];
  if (path === '') return withFragment(normalizePath(baseFile), fragment);
  const rooted = path.startsWith('/') || path.startsWith('\\');
  const joined = rooted ? path : dirname(baseFile) + path;
  return withFragment(normalizePath(joined), fragment);
}

/**
 * Case- and encoding-insensitive comparison key for a package path:
 * decoded, NFC-normalized, separators folded, dot segments removed,
 * lower-cased. Two different files may share a key (e.g. `CH3.xhtml` and
 * `Ch3.xhtml`), so key lookups must treat collisions as ambiguous.
 */
export function canonicalKey(path: string): string {
  return normalizePath(safeDecode(splitFragment(path)[0]).normalize('NFC')).toLowerCase();
}
