/**
 * The parts of an OPF package document the TOC and cover resolvers need,
 * parsed once into plain data. Built either from the raw OPF (import, the
 * Drive range reader, tests) or from epub.js's already-parsed packaging
 * (the live reader) — both produce the same shape.
 */
import { byLocalName } from './markup';
import { dirname } from './paths';

export interface ManifestEntry {
  id: string;
  /** As written in the OPF: relative to the OPF's directory, possibly percent-encoded. */
  href: string;
  mediaType: string;
  properties: string[];
}

export interface PackageModel {
  /** Zip path of the OPF (e.g. `OEBPS/content.opf`). */
  opfPath: string;
  /** Zip directory of the OPF (`OEBPS/`, or `''` at the root). */
  opfDir: string;
  manifest: ManifestEntry[];
  /** Manifest hrefs of the spine items, in reading order. */
  spine: string[];
  /** OPF-relative path of the EPUB 3 nav document, if declared. */
  navPath?: string;
  /** OPF-relative path of the NCX, if declared. */
  ncxPath?: string;
  /** Raw `content` of `<meta name="cover">` (an id by spec; an href in the wild). */
  metaCover?: string;
  /** EPUB 2 `<guide>` references (OPF-relative hrefs). */
  guide: { type: string; href: string }[];
}

const NCX_MEDIA_TYPE = 'application/x-dtbncx+xml';

export function parsePackageDocument(opf: Document, opfPath: string): PackageModel {
  const manifest: ManifestEntry[] = [];
  for (const item of byLocalName(opf, 'item')) {
    const href = item.getAttribute('href');
    if (!href) continue;
    manifest.push({
      id: item.getAttribute('id') ?? '',
      href,
      mediaType: (item.getAttribute('media-type') ?? '').toLowerCase(),
      properties: (item.getAttribute('properties') ?? '').split(/\s+/).filter(Boolean),
    });
  }
  const byId = new Map(manifest.map((m) => [m.id, m]));

  const spineEl = byLocalName(opf, 'spine')[0];
  const spine: string[] = [];
  for (const ref of byLocalName(opf, 'itemref')) {
    const entry = byId.get(ref.getAttribute('idref') ?? '');
    if (entry) spine.push(entry.href);
  }

  const tocId = spineEl?.getAttribute('toc');
  const ncx =
    (tocId ? byId.get(tocId) : undefined) ?? manifest.find((m) => m.mediaType === NCX_MEDIA_TYPE);

  const coverMeta = byLocalName(opf, 'meta').find((m) => m.getAttribute('name') === 'cover');

  const guide = byLocalName(opf, 'reference')
    .map((r) => ({ type: (r.getAttribute('type') ?? '').toLowerCase(), href: r.getAttribute('href') ?? '' }))
    .filter((r) => r.href);

  return {
    opfPath,
    opfDir: dirname(opfPath),
    manifest,
    spine,
    navPath: manifest.find((m) => m.properties.includes('nav'))?.href,
    ncxPath: ncx?.href,
    metaCover: coverMeta?.getAttribute('content')?.trim() || undefined,
    guide,
  };
}

/** epub.js `packaging.manifest` entry shape (only the fields read here). */
export interface EpubJsManifestItem {
  href: string;
  type?: string;
  properties?: string[];
}

/**
 * Build the model from epub.js's parsed packaging (live reader). epub.js
 * keeps neither `<guide>` nor the meta-cover content, so those stay empty —
 * the reader only resolves TOC hrefs, never covers.
 */
export function packageModelFromEpubJs(input: {
  opfPath: string;
  manifest: Record<string, EpubJsManifestItem>;
  spineHrefs: string[];
  navPath?: string;
  ncxPath?: string;
}): PackageModel {
  return {
    opfPath: input.opfPath,
    opfDir: dirname(input.opfPath),
    manifest: Object.entries(input.manifest).map(([id, m]) => ({
      id,
      href: m.href,
      mediaType: (m.type ?? '').toLowerCase(),
      properties: m.properties ?? [],
    })),
    spine: input.spineHrefs,
    navPath: input.navPath || undefined,
    ncxPath: input.ncxPath || undefined,
    guide: [],
  };
}
