/**
 * Map raw TOC hrefs onto the spine — the TOC half of the malformed-EPUB
 * hardening (plan/epub-toc-cover-hardening.md §4.2).
 *
 * epub.js stores nav hrefs verbatim and only ever resolves against the OPF's
 * directory, so a nav document in a subfolder (`Text/toc.xhtml` linking
 * `../Text/ch1.xhtml`) produced a TOC whose every click failed. Here each
 * href is tried against a ladder of interpretations and rewritten to the
 * exact spine href (+ fragment) epub.js expects; entries that cannot land in
 * the spine are kept and flagged `unresolved` so the UI can grey them out.
 *
 * The pass is idempotent in `stored` order: an already-resolved TOC is
 * matched on its first rung and comes back unchanged, which is what lets the
 * reader heal TOCs persisted by older builds on every open with no migration.
 */
import type { NavigationItem } from '~types/book';
import type { MatchStrength, PackageIndex } from './packageIndex';
import { normalizePath, resolveRelative, splitFragment, withFragment } from './paths';

export interface TocResolveContext {
  index: PackageIndex;
  /** OPF-relative path of the document the hrefs were written in (nav/NCX). */
  tocPath?: string;
  /**
   * `raw` (fresh from the nav/NCX): interpret hrefs relative to `tocPath`
   * first, as the spec says. `stored` (already passed through here once):
   * try the href as-is first, so re-resolving is a no-op.
   */
  order?: 'raw' | 'stored';
}

const STRENGTHS: MatchStrength[] = ['strict', 'canonical', 'basename'];

/** Candidate OPF-relative readings of one href path, strongest first. */
function candidates(path: string, ctx: TocResolveContext): string[] {
  const { index, tocPath } = ctx;
  const asIs = normalizePath(path);
  const tocRelative = tocPath !== undefined ? splitFragment(resolveRelative(tocPath, path))[0] : undefined;
  // Zip-root readings: `/OEBPS/x.xhtml` and `OEBPS/x.xhtml` both mean the
  // OPF-relative `x.xhtml` when the OPF lives in `OEBPS/`.
  const opfDir = index.model.opfDir.toLowerCase();
  let rootRelative: string | undefined;
  if (opfDir && asIs.toLowerCase().startsWith(opfDir)) rootRelative = asIs.slice(opfDir.length);

  const ordered =
    ctx.order === 'stored' ? [asIs, tocRelative, rootRelative] : [tocRelative, asIs, rootRelative];
  return [...new Set(ordered.filter((c): c is string => !!c))];
}

/**
 * Resolve one href to `spineHref[#fragment]`. Returns `null` when no reading
 * lands in the spine (missing file, or a manifest item outside the spine —
 * epub.js cannot display those).
 */
export function resolveTocHref(href: string, ctx: TocResolveContext): string | null {
  const [path, fragment] = splitFragment(href.trim());
  if (!path) return null;
  const readings = candidates(path, ctx);
  // Exact matches across every reading first, then progressively weaker
  // matches — a weak match on the preferred reading must not beat an exact
  // match on another one. A hit on a manifest item OUTSIDE the spine stops
  // the descent: the reference is real, just not displayable, and a weaker
  // rung would only find some other (wrong) file.
  for (const strength of ['exact', ...STRENGTHS] as MatchStrength[]) {
    let nonSpineHit = false;
    for (const reading of readings) {
      const hit = ctx.index.find(reading, strength);
      if (!hit || hit.strength !== strength) continue;
      if (ctx.index.spineIndexOf(hit.entry.href) >= 0) return withFragment(hit.entry.href, fragment);
      nonSpineHit = true;
    }
    if (nonSpineHit) return null;
  }
  return null;
}

function fileOf(href: string | null | undefined): string | null {
  return href ? splitFragment(href)[0] || null : null;
}

function firstResolved(items: NavigationItem[] | undefined): string | null {
  for (const item of items ?? []) {
    if (!item.unresolved && item.href) return item.href;
    const nested = firstResolved(item.subitems);
    if (nested) return nested;
  }
  return null;
}

/**
 * Resolve a whole TOC tree. Returns a new tree (inputs are not mutated):
 * resolved entries carry the spine href, unresolved ones keep their raw href
 * and get `unresolved: true`.
 *
 *  - fragment-only hrefs (`#sec2`) resolve against the nav document when it
 *    is itself in the spine, else against the enclosing entry's file, else
 *    the preceding entry's file;
 *  - grouping entries without a usable href (`<span>` headings) take their
 *    first resolvable descendant's target.
 */
export function resolveToc(items: NavigationItem[], ctx: TocResolveContext): NavigationItem[] {
  let previousFile: string | null = null;

  const walk = (list: NavigationItem[], parentFile: string | null): NavigationItem[] =>
    list.map((item) => {
      const raw = (item.href ?? '').trim();
      const [rawPath, fragment] = splitFragment(raw);
      let target: string | null = rawPath ? resolveTocHref(raw, ctx) : null;

      if (!target && !rawPath && fragment) {
        const navFile = ctx.tocPath !== undefined ? resolveTocHref(ctx.tocPath, { ...ctx, order: 'stored' }) : null;
        const file = fileOf(navFile) ?? parentFile ?? previousFile;
        if (file) target = withFragment(file, fragment);
      }

      const subitems = item.subitems?.length ? walk(item.subitems, fileOf(target) ?? parentFile) : undefined;
      if (!target && !rawPath) target = firstResolved(subitems);
      if (target) previousFile = fileOf(target);

      const next: NavigationItem = { ...item, href: target ?? item.href };
      if (subitems) next.subitems = subitems;
      if (target) delete next.unresolved;
      else next.unresolved = true;
      return next;
    });

  return walk(items, null);
}

export interface TocScore {
  total: number;
  resolved: number;
  resolveRate: number;
  distinctTargets: number;
}

/** Count how much of an (already resolved) TOC lands in the spine. */
export function scoreToc(items: NavigationItem[]): TocScore {
  let total = 0;
  let resolved = 0;
  const targets = new Set<string>();
  const visit = (list: NavigationItem[]) => {
    for (const item of list) {
      total++;
      if (!item.unresolved) {
        resolved++;
        const file = fileOf(item.href);
        if (file) targets.add(file);
      }
      if (item.subitems) visit(item.subitems);
    }
  };
  visit(items);
  return { total, resolved, resolveRate: total ? resolved / total : 0, distinctTargets: targets.size };
}

/** Structural equality on the fields resolution can change. */
export function tocEquals(a: NavigationItem[], b: NavigationItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.id === y.id &&
      x.href === y.href &&
      x.label === y.label &&
      !!x.unresolved === !!y.unresolved &&
      tocEquals(x.subitems ?? [], y.subitems ?? [])
    );
  });
}
