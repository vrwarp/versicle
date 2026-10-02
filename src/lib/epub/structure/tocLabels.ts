/**
 * TOC label quality and source arbitration (plan §4.2, decisions §9.2/§9.5).
 *
 * Books in the wild ship TOC labels that are useless to a reader: tooling
 * placeholders (`*FIX_Title.543173.int`), every entry identical, file names,
 * or bare ordinals ("Chapter 7"). When another source — the other TOC file,
 * or the chapter heading extraction derived — has a real label for the SAME
 * spine target, it replaces the junk one. Labels are never blanked and an
 * entry is never dropped because of its label. The merge is silent; callers
 * log which source supplied hrefs and labels.
 */
import type { NavigationItem } from '~types/book';
import { splitFragment } from './paths';
import { scoreToc, type TocScore } from './tocResolver';

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^\*?fix_/i, // InDesign/Sigil export placeholders
  /\.int$/i,
  /^untitled(\s+\d+)?$/i,
  /^(unknown|null|undefined|none|n\/a|tbd|todo|toc|contents?)$/i,
  /^[-–—_.\s]+$/,
];

/** A file name rather than a title (`ch01.xhtml`, `part0003_split_001.html`). */
const FILENAME_PATTERN = /^[\w\-.%]+\.(x?html?|xml|ncx|opf)$/i;

const ROMAN = '(?=[mdclxvi])m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})';
const ORDINAL_WITH_KEYWORD = new RegExp(
  `^(?:chapter|chap\\.?|ch\\.?|part|section|sect\\.?|book|kapitel|chapitre|cap[ií]tulo)\\s*(?:\\d+|${ROMAN})\\.?$`,
  'i',
);
/** Without a keyword only digits or an UPPER-CASE numeral count ("Mix" is a word). */
const BARE_NUMBER = /^\d+\.?$/;
const BARE_ROMAN = new RegExp(`^${ROMAN.toUpperCase()}\\.?$`);

/** True for a label that carries no title of its own. */
export function isLowQualityLabel(label: string | undefined | null): boolean {
  const text = (label ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (PLACEHOLDER_PATTERNS.some((p) => p.test(text))) return true;
  if (FILENAME_PATTERN.test(text)) return true;
  if (ORDINAL_WITH_KEYWORD.test(text)) return true;
  return BARE_NUMBER.test(text) || BARE_ROMAN.test(text);
}

function flatten(items: NavigationItem[], out: NavigationItem[] = []): NavigationItem[] {
  for (const item of items) {
    out.push(item);
    if (item.subitems) flatten(item.subitems, out);
  }
  return out;
}

/**
 * Per-entry label quality for a whole tree: an entry is junk when its label
 * is low quality, or when the tree repeats one label across 3+ entries
 * (an all-identical TOC like the `*FIX_` NCX).
 */
function junkMask(items: NavigationItem[]): Set<NavigationItem> {
  const flat = flatten(items);
  const counts = new Map<string, number>();
  for (const item of flat) {
    const key = item.label.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const junk = new Set<NavigationItem>();
  for (const item of flat) {
    const repeated = flat.length >= 3 && (counts.get(item.label.trim().toLowerCase()) ?? 0) === flat.length;
    if (repeated || isLowQualityLabel(item.label)) junk.add(item);
  }
  return junk;
}

/** Share of entries whose labels are junk (0 for an empty tree). */
export function junkLabelRate(items: NavigationItem[]): number {
  const total = flatten(items).length;
  return total ? junkMask(items).size / total : 0;
}

/**
 * Replace junk labels with a better label for the same target.
 *
 * Lookup order per junk entry: an alternative-source entry with the same
 * href (file + fragment); for fragment-less entries, an alternative entry
 * on the same file; then `chapterTitles` (spine href → derived heading).
 * Alternatives are themselves junk-filtered. Returns a new tree.
 */
export function repairTocLabels(
  items: NavigationItem[],
  alternatives: NavigationItem[][] = [],
  chapterTitles?: ReadonlyMap<string, string>,
): NavigationItem[] {
  const junk = junkMask(items);
  if (junk.size === 0) return items;

  const byHref = new Map<string, string>();
  const byFile = new Map<string, string>();
  for (const alt of alternatives) {
    const altJunk = junkMask(alt);
    for (const entry of flatten(alt)) {
      if (entry.unresolved || altJunk.has(entry) || !entry.href) continue;
      const label = entry.label.replace(/\s+/g, ' ').trim();
      if (!byHref.has(entry.href)) byHref.set(entry.href, label);
      const file = splitFragment(entry.href)[0];
      if (!byFile.has(file)) byFile.set(file, label);
    }
  }

  const pick = (item: NavigationItem): string | undefined => {
    if (item.unresolved || !item.href) return undefined;
    const [file, fragment] = splitFragment(item.href);
    const direct = byHref.get(item.href);
    if (direct) return direct;
    if (fragment) return undefined;
    const sameFile = byFile.get(file);
    if (sameFile) return sameFile;
    // Derived titles fall back to the first paragraph when a chapter has no
    // heading; a truncated sentence is not a better label than "Chapter 7".
    const derived = chapterTitles?.get(file)?.trim();
    if (!derived || /(\.\.\.|\u2026)$/.test(derived) || isLowQualityLabel(derived)) return undefined;
    return derived;
  };

  const walk = (list: NavigationItem[]): NavigationItem[] =>
    list.map((item) => {
      const better = junk.has(item) ? pick(item) : undefined;
      const subitems = item.subitems ? walk(item.subitems) : undefined;
      if (!better && subitems === item.subitems) return item;
      const next: NavigationItem = { ...item, label: better ?? item.label };
      if (subitems) next.subitems = subitems;
      return next;
    });
  return walk(items);
}

export type TocSourceKind = 'nav' | 'ncx';

export interface TocSourceCandidate {
  kind: TocSourceKind;
  /** Already resolved against the spine (see `resolveToc`). */
  items: NavigationItem[];
}

export interface TocChoice {
  toc: NavigationItem[];
  /** Which source supplied the structure and hrefs (`null` when none had entries). */
  source: TocSourceKind | null;
  score: TocScore | null;
  /** Junk-label share of the chosen source before repair. */
  junkRateBefore: number;
  junkRateAfter: number;
}

/**
 * Pick the TOC source and repair its labels from the others.
 *
 * Candidates are given in priority order (nav before NCX). A lower-priority
 * source wins only when
 *  - it reaches strictly more distinct spine documents (a nav listing only
 *    parts loses to an NCX listing every chapter), or
 *  - the current pick is mostly broken (under half its entries resolve) and
 *    the other resolves a larger share, or
 *  - the current pick fails the label floor (over half junk) while the other
 *    resolves at least as well and has better labels.
 * A few dead links in an otherwise good nav do NOT hand the TOC to a
 * flatter NCX — those entries are kept and greyed out instead.
 */
export function chooseTocSource(
  candidates: TocSourceCandidate[],
  chapterTitles?: ReadonlyMap<string, string>,
): TocChoice {
  const scored = candidates
    .filter((c) => c.items.length > 0)
    .map((c) => ({ ...c, score: scoreToc(c.items), junk: junkLabelRate(c.items) }));
  if (scored.length === 0) {
    return { toc: [], source: null, score: null, junkRateBefore: 0, junkRateAfter: 0 };
  }

  let best = scored[0];
  for (const other of scored.slice(1)) {
    const betterResolve =
      other.score.distinctTargets > best.score.distinctTargets ||
      (best.score.resolveRate < 0.5 && other.score.resolveRate > best.score.resolveRate + 1e-9);
    const labelRescue =
      best.junk > 0.5 && other.junk < best.junk && other.score.resolveRate >= best.score.resolveRate - 1e-9;
    if (betterResolve || labelRescue) best = other;
  }

  const alternatives = scored.filter((c) => c !== best).map((c) => c.items);
  const toc = repairTocLabels(best.items, alternatives, chapterTitles);
  return {
    toc,
    source: best.kind,
    score: best.score,
    junkRateBefore: best.junk,
    junkRateAfter: junkLabelRate(toc),
  };
}
