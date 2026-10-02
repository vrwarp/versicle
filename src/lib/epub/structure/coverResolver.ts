/**
 * Find a book's cover when the package doesn't declare one properly — the
 * cover half of the malformed-EPUB hardening (plan §4.3).
 *
 * epub.js only honours the two OPF markers (`properties="cover-image"`,
 * `<meta name="cover" content="{id}">`). Books in the wild instead put the
 * cover in a cover XHTML page (`<img>` or SVG `<image>`), point the meta at
 * an href, declare it only in `<guide>`/landmarks, or just name the file
 * `cover.jpg`. `findCoverCandidates` lists every plausible candidate in
 * priority order; `chooseCover` reads and validates them in turn so a
 * corrupt file or a publisher logo never wins over the real cover.
 */
import { byLocalName, epubTypes, linkTarget, parseMarkup } from './markup';
import type { Landmark } from './navParser';
import type { PackageIndex } from './packageIndex';
import type { ManifestEntry } from './packageModel';
import { basename, normalizePath, resolveRelative, splitFragment } from './paths';

export type CoverReason =
  | 'cover-image-property'
  | 'meta-cover'
  | 'guide'
  | 'landmark'
  | 'cover-document'
  | 'first-document'
  | 'named-image'
  | 'document-image';

export interface CoverCandidate {
  /** OPF-relative path of the image. */
  href: string;
  mediaType: string;
  reason: CoverReason;
  /** Declared by the package itself (cover-image / meta cover): size checks only warn. */
  explicit: boolean;
  /** The XHTML document the image was found in, when it came from one. */
  via?: string;
}

export interface CoverSourcePort {
  /** Text of a package file by OPF-relative path; `undefined` if missing or over budget. */
  readText(opfRelative: string): Promise<string | undefined>;
}

export interface FindCoverOptions {
  landmarks?: Landmark[];
  /** How many leading spine documents to open looking for a cover page (default 3). */
  maxDocuments?: number;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

/** `cover`, `front`, or an `FC` token (`Book_FC.jpg` = front cover). */
const NAMED_COVER = /cover|front|(^|[^a-z0-9])fc([^a-z0-9]|$)/i;

function guessMediaType(path: string): string {
  const ext = splitFragment(path)[0].split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS[ext] ?? '';
}

function isImage(mediaType: string, path: string): boolean {
  return mediaType.startsWith('image/') || (!mediaType && guessMediaType(path) !== '');
}

function isDocument(entry: ManifestEntry): boolean {
  return /x?html|xml/.test(entry.mediaType) || /\.x?html?$/i.test(entry.href);
}

/** Image references in an XHTML document, in document order, resolved to OPF-relative paths. */
export function imagesInDocument(docText: string, docPath: string): string[] {
  const doc = parseMarkup(docText, 'application/xhtml+xml');
  const refs: string[] = [];
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const name = el.localName.toLowerCase();
    if (name !== 'img' && name !== 'image' && !name.endsWith(':image')) continue;
    const src = name === 'img' ? el.getAttribute('src') : linkTarget(el);
    if (!src || /^(data|https?|blob):/i.test(src.trim())) continue;
    refs.push(splitFragment(resolveRelative(docPath, src))[0]);
  }
  return [...new Set(refs)];
}

/** Does the document declare itself a cover page (`epub:type="cover"` on body/section)? */
function declaresCover(docText: string): boolean {
  const doc = parseMarkup(docText, 'application/xhtml+xml');
  return [...byLocalName(doc, 'body'), ...byLocalName(doc, 'section'), ...byLocalName(doc, 'div')].some((el) =>
    epubTypes(el).includes('cover'),
  );
}

export async function findCoverCandidates(
  index: PackageIndex,
  port: CoverSourcePort,
  options: FindCoverOptions = {},
): Promise<CoverCandidate[]> {
  const out: CoverCandidate[] = [];
  const seen = new Set<string>();
  const docsRead = new Map<string, string | undefined>();

  const readDoc = async (path: string): Promise<string | undefined> => {
    if (!docsRead.has(path)) docsRead.set(path, await port.readText(path).catch(() => undefined));
    return docsRead.get(path);
  };

  const addImage = (path: string, reason: CoverReason, explicit: boolean, via?: string) => {
    const entry = index.find(path)?.entry;
    const href = entry?.href ?? normalizePath(path);
    const key = href.toLowerCase();
    if (seen.has(key)) return;
    const mediaType = entry?.mediaType || guessMediaType(href);
    if (!isImage(mediaType, href)) return;
    seen.add(key);
    out.push({ href, mediaType, reason, explicit, ...(via ? { via } : {}) });
  };

  /** A reference that may be an image or a document holding the image. */
  const addReference = async (path: string, reason: CoverReason, explicit: boolean) => {
    const entry = index.find(path)?.entry;
    const href = entry?.href ?? normalizePath(path);
    if (entry && isDocument(entry) && !entry.mediaType.startsWith('image/')) {
      const text = await readDoc(href);
      if (text) for (const img of imagesInDocument(text, href)) addImage(img, reason, explicit, href);
      return;
    }
    addImage(href, reason, explicit);
  };

  const { model } = index;

  // 1. EPUB 3 cover-image property (may wrongly point at an XHTML page).
  for (const entry of model.manifest.filter((m) => m.properties.includes('cover-image'))) {
    await addReference(entry.href, 'cover-image-property', true);
  }

  // 2. EPUB 2 <meta name="cover">: an id by spec, an href or file name in the wild.
  if (model.metaCover) {
    const byId = index.findById(model.metaCover);
    await addReference(byId?.href ?? model.metaCover, 'meta-cover', true);
  }

  // 3. Declared cover documents: <guide> and nav landmarks.
  for (const ref of model.guide.filter((g) => g.type === 'cover')) {
    await addReference(splitFragment(ref.href)[0], 'guide', false);
  }
  for (const mark of (options.landmarks ?? []).filter((l) => l.type === 'cover')) {
    const path = model.navPath ? resolveRelative(model.navPath, mark.href) : mark.href;
    await addReference(splitFragment(path)[0], 'landmark', false);
  }

  // 4. Cover-ish spine documents: named like a cover, or declaring
  //    epub:type="cover", within the first few; the first spine document
  //    is the conventional cover page even when unlabeled.
  const maxDocs = options.maxDocuments ?? 3;
  const leading = model.spine.slice(0, maxDocs);
  const namedDocs = model.spine.filter((href) => {
    const entry = index.find(href)?.entry;
    return /cover/i.test(href) || /cover/i.test(entry?.id ?? '');
  });
  const otherDocImages: Array<{ img: string; via: string }> = [];
  for (const href of [...new Set([...namedDocs, ...leading])]) {
    const text = await readDoc(href);
    if (!text) continue;
    const coverish = namedDocs.includes(href) || declaresCover(text);
    const images = imagesInDocument(text, href);
    if (coverish) images.forEach((img) => addImage(img, 'cover-document', false, href));
    else if (href === model.spine[0]) images.forEach((img) => addImage(img, 'first-document', false, href));
    else images.forEach((img) => otherDocImages.push({ img, via: href }));
  }

  // 5. Images named like a cover.
  for (const entry of model.manifest) {
    if (isImage(entry.mediaType, entry.href) && (NAMED_COVER.test(basename(entry.href)) || NAMED_COVER.test(entry.id))) {
      addImage(entry.href, 'named-image', false);
    }
  }

  // 6. Any image in the other leading documents (validation filters logos).
  for (const { img, via } of otherDocImages) addImage(img, 'document-image', false, via);

  return out;
}

// ── Validation ────────────────────────────────────────────────────────────

export type ImageProbeResult = { width: number; height: number } | 'undecodable' | 'unknown';
export type ImageProbe = (blob: Blob) => Promise<ImageProbeResult>;

export interface CoverPick {
  candidate: CoverCandidate;
  blob: Blob;
  width?: number;
  height?: number;
}

export interface CoverRejection {
  candidate: CoverCandidate;
  why: 'missing' | 'undecodable' | 'implausible-size' | 'unverifiable';
}

export interface CoverChoice {
  pick?: CoverPick;
  rejected: CoverRejection[];
}

/** Portrait-ish and big enough to be a cover, not a logo, icon or spacer. */
export function isPlausibleCoverSize(width: number, height: number): boolean {
  if (width < 150 || height < 200) return false;
  const ratio = width / height;
  return ratio >= 0.4 && ratio <= 1.1;
}

/**
 * Reasons trusted when the platform cannot decode images (no
 * `createImageBitmap`, e.g. unit tests): explicit declarations and
 * cover-named pages/images. Anonymous document images need a size check.
 */
const TRUSTED_UNVERIFIED: ReadonlySet<CoverReason> = new Set([
  'cover-image-property',
  'meta-cover',
  'guide',
  'landmark',
  'cover-document',
  'named-image',
]);

export async function chooseCover(
  candidates: CoverCandidate[],
  readBlob: (candidate: CoverCandidate) => Promise<Blob | undefined>,
  probe: ImageProbe,
): Promise<CoverChoice> {
  const rejected: CoverRejection[] = [];
  for (const candidate of candidates) {
    const blob = await readBlob(candidate).catch(() => undefined);
    if (!blob || blob.size === 0) {
      rejected.push({ candidate, why: 'missing' });
      continue;
    }
    const probed = await probe(blob).catch((): ImageProbeResult => 'undecodable');
    if (probed === 'undecodable') {
      rejected.push({ candidate, why: 'undecodable' });
      continue;
    }
    if (probed === 'unknown') {
      if (TRUSTED_UNVERIFIED.has(candidate.reason)) return { pick: { candidate, blob }, rejected };
      rejected.push({ candidate, why: 'unverifiable' });
      continue;
    }
    if (candidate.explicit || isPlausibleCoverSize(probed.width, probed.height)) {
      return { pick: { candidate, blob, width: probed.width, height: probed.height }, rejected };
    }
    rejected.push({ candidate, why: 'implausible-size' });
  }
  return { rejected };
}
