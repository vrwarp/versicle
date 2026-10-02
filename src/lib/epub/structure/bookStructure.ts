/**
 * One entry point over the structure resolvers for callers that hold the
 * whole archive (local import, reprocess, the cover backfill) or a ranged
 * view of it (the Drive preview): read the OPF (+ nav/NCX), then resolve the
 * TOC and/or the cover. Archive access goes through a tiny port so this
 * module never imports jszip or epub.js (they ride lazy chunks).
 */
import type { NavigationItem } from '~types/book';
import { chooseCover, findCoverCandidates, type CoverCandidate, type CoverChoice, type ImageProbe } from './coverResolver';
import { probeImage } from './imageProbe';
import { parseMarkup } from './markup';
import { parseNavDocument, parseNcxDocument, type ParsedNav } from './navParser';
import { PackageIndex } from './packageIndex';
import { parsePackageDocument } from './packageModel';
import { chooseTocSource, type TocChoice } from './tocLabels';
import { resolveToc } from './tocResolver';

export interface ArchivePort {
  /** Text of a zip entry by zip path (as written; may be percent-encoded). */
  readText(zipPath: string): Promise<string | undefined>;
  /** Bytes of a zip entry as a Blob of `mediaType`. */
  readBlob(zipPath: string, mediaType: string): Promise<Blob | undefined>;
}

export interface BookStructure {
  index: PackageIndex;
  nav: ParsedNav | null;
  ncx: NavigationItem[] | null;
}

async function readTextSafe(archive: ArchivePort, zipPath: string): Promise<string | undefined> {
  try {
    return await archive.readText(zipPath);
  } catch {
    return undefined;
  }
}

/**
 * Parse the package. `toc: false` skips the nav/NCX reads (the Drive
 * preview only wants the cover and pays per read).
 */
export async function readBookStructure(
  archive: ArchivePort,
  opfPath: string,
  options: { toc?: boolean } = {},
): Promise<BookStructure | null> {
  const opfText = await readTextSafe(archive, opfPath);
  if (!opfText) return null;
  const index = new PackageIndex(parsePackageDocument(parseMarkup(opfText), opfPath));
  if (options.toc === false) return { index, nav: null, ncx: null };

  const { navPath, ncxPath } = index.model;
  const navText = navPath ? await readTextSafe(archive, index.toZipPath(navPath)) : undefined;
  const ncxText = ncxPath ? await readTextSafe(archive, index.toZipPath(ncxPath)) : undefined;
  return {
    index,
    nav: navText ? parseNavDocument(parseMarkup(navText, 'application/xhtml+xml')) : null,
    ncx: ncxText ? parseNcxDocument(parseMarkup(ncxText)) : null,
  };
}

/** Resolve nav and NCX against the spine and pick/repair the best TOC. */
export function resolveStructureToc(
  structure: BookStructure,
  chapterTitles?: ReadonlyMap<string, string>,
): TocChoice {
  const { index, nav, ncx } = structure;
  const { navPath, ncxPath } = index.model;
  return chooseTocSource(
    [
      { kind: 'nav', items: nav ? resolveToc(nav.toc, { index, tocPath: navPath, order: 'raw' }) : [] },
      { kind: 'ncx', items: ncx ? resolveToc(ncx, { index, tocPath: ncxPath, order: 'raw' }) : [] },
    ],
    chapterTitles,
  );
}

/**
 * Resolve a TOC tree parsed elsewhere (epub.js's navigation) against this
 * package — the fallback when neither nav nor NCX parsed here yielded
 * entries but epub.js did.
 */
export function resolveForeignToc(structure: BookStructure, items: NavigationItem[]): NavigationItem[] {
  const { index } = structure;
  return resolveToc(items, { index, tocPath: index.model.navPath ?? index.model.ncxPath, order: 'raw' });
}

export interface CoverResolution extends CoverChoice {
  candidates: CoverCandidate[];
}

/**
 * List, read and validate cover candidates; first plausible one wins.
 * Two passes: the package's own declarations first (no spine documents
 * opened — the common, well-formed case), then the full heuristic list
 * minus anything the first pass already rejected.
 */
export async function resolveStructureCover(
  structure: BookStructure,
  archive: ArchivePort,
  probe: ImageProbe = probeImage,
): Promise<CoverResolution> {
  const { index } = structure;
  const source = { readText: (path: string) => readTextSafe(archive, index.toZipPath(path)) };
  const read = (c: CoverCandidate) => archive.readBlob(index.toZipPath(c.href), c.mediaType);
  const landmarks = structure.nav?.landmarks;

  const declared = await findCoverCandidates(index, source, { landmarks, declaredOnly: true });
  const first = await chooseCover(declared, read, probe);
  if (first.pick) return { ...first, candidates: declared };

  const all = await findCoverCandidates(index, source, { landmarks });
  const tried = new Set(declared.map((c) => c.href));
  const second = await chooseCover(
    all.filter((c) => !tried.has(c.href)),
    read,
    probe,
  );
  return { pick: second.pick, rejected: [...first.rejected, ...second.rejected], candidates: all };
}
