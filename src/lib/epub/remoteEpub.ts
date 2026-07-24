/**
 * `RemoteEpubReader` — extract an EPUB's metadata and cover from a handful of
 * byte RANGES, without downloading the whole file. This is the pure engine
 * behind the Google Drive partial-fetch previews (see
 * plan/gdrive-partial-metadata.md); it knows only "how to read an EPUB through
 * a `readRange` port", nothing about Drive or the network gateway.
 *
 * The premise, corrected from the naive "the listing is at the front": a ZIP's
 * authoritative directory (the End Of Central Directory record + central
 * directory) lives at the END of the archive. So the first read is a TAIL
 * fetch; from the central directory we compute the exact byte range of each
 * entry we want (container.xml → the OPF → the cover) and fetch only those.
 *
 * OCF permits only stored (method 0) and deflate (method 8); deflate is
 * inflated with the platform-native `DecompressionStream('deflate-raw')` — no
 * decompression dependency. ZIP64 archives (EPUBs > 4 GB / > 65 535 entries)
 * are detected and rejected rather than parsed.
 *
 * Pure module: no store/network/Drive imports. Every malformed-structure path
 * throws {@link UnextractableEpubError} so the caller can negative-cache the
 * file instead of retrying it forever.
 */

/** The port the reader pulls bytes through. `end` is INCLUSIVE (HTTP Range). */
export interface RangeReader {
  /** Total file size in bytes (lets the reader compute tail offsets). */
  readonly size: number;
  /** Resolve to the bytes of `[start, end]` inclusive. */
  readRange(start: number, end: number): Promise<ArrayBuffer>;
}

/** The extracted preview. All metadata fields are best-effort/optional. */
export interface RemoteEpubPreview {
  title?: string;
  author?: string;
  description?: string;
  /** Raw OPF `dc:language` (unnormalized). */
  language?: string;
  /** Every `dc:identifier` found (ISBNs, UUIDs, …), in document order. */
  identifiers: string[];
  /** The cover image bytes + its manifest media-type, when one was found. */
  cover?: { bytes: ArrayBuffer; mediaType: string };
}

/** Why a file could not be read via ranges — the negative-cache reason. */
export type UnextractableReason =
  | 'eocd-not-found'
  | 'zip64-unsupported'
  | 'bad-central-directory'
  | 'bad-local-header'
  | 'unsupported-compression'
  | 'missing-container'
  | 'missing-opf'
  | 'inflate-failed';

export class UnextractableEpubError extends Error {
  constructor(public readonly reason: UnextractableReason, detail?: string) {
    super(`EPUB not extractable via ranges (${reason})${detail ? `: ${detail}` : ''}`);
    this.name = 'UnextractableEpubError';
  }
}

// ── ZIP structural constants ────────────────────────────────────────────────
const SIG_LOCAL = 0x04034b50; // PK\x03\x04
const SIG_CENTRAL = 0x02014b50; // PK\x01\x02
const SIG_EOCD = 0x06054b50; // PK\x05\x06
const SIG_ZIP64_LOCATOR = 0x07064b50; // PK\x06\x07
const EOCD_MIN_SIZE = 22;
const ZIP_MAX_COMMENT = 0xffff;
/** How much tail to fetch: EOCD (22) + the max ZIP comment (65535). */
const TAIL_FETCH = EOCD_MIN_SIZE + ZIP_MAX_COMMENT;
/** Slack added past the local-header estimate to grab the entry in one read. */
const LOCAL_EXTRA_SLACK = 512;

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function dv(buf: ArrayBuffer): DataView {
  return new DataView(buf);
}

/** Inflate a compressed entry (method 0 stored / 8 deflate). */
async function inflate(bytes: Uint8Array, method: number): Promise<ArrayBuffer> {
  if (method === 0) {
    // Stored: copy out to an owned buffer (bytes may be a view onto a larger one).
    return bytes.slice().buffer;
  }
  if (method !== 8) {
    throw new UnextractableEpubError('unsupported-compression', `method ${method}`);
  }
  try {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    // Copy into a fresh ArrayBuffer-backed view: the input may be a subarray of
    // a larger (possibly SharedArrayBuffer-typed) buffer, which the stream
    // writer's BufferSource typing rejects.
    const chunk = new Uint8Array(bytes);
    void writer.write(chunk);
    void writer.close();
    return await new Response(ds.readable).arrayBuffer();
  } catch (error) {
    throw new UnextractableEpubError('inflate-failed', String(error));
  }
}

/** Locate + parse the EOCD record within the fetched tail buffer. */
function parseEocd(
  tail: ArrayBuffer,
  tailStart: number,
): { cdOffset: number; cdSize: number; entryCount: number } {
  const view = dv(tail);
  // Scan backwards for the EOCD signature (a ZIP comment may follow it).
  for (let i = tail.byteLength - EOCD_MIN_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) !== SIG_EOCD) continue;
    const entryCount = view.getUint16(i + 10, true);
    const cdSize = view.getUint32(i + 12, true);
    const cdOffset = view.getUint32(i + 16, true);
    const commentLen = view.getUint16(i + 20, true);
    // Sanity: the record + its comment should reach the end of the tail.
    if (i + EOCD_MIN_SIZE + commentLen !== tail.byteLength) continue;
    // ZIP64 sentinels — bail (we don't parse the ZIP64 records).
    if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new UnextractableEpubError('zip64-unsupported');
    }
    // A ZIP64 EOCD locator immediately precedes a real ZIP64 EOCD.
    if (i >= 20 && view.getUint32(i - 20, true) === SIG_ZIP64_LOCATOR) {
      throw new UnextractableEpubError('zip64-unsupported');
    }
    void tailStart;
    return { cdOffset, cdSize, entryCount };
  }
  throw new UnextractableEpubError('eocd-not-found');
}

/** Parse the central directory bytes into a name→entry map. */
function parseCentralDirectory(cd: ArrayBuffer, entryCount: number): Map<string, CentralEntry> {
  const view = dv(cd);
  const decoder = new TextDecoder();
  const entries = new Map<string, CentralEntry>();
  let offset = 0;
  for (let n = 0; n < entryCount; n++) {
    if (offset + 46 > cd.byteLength || view.getUint32(offset, true) !== SIG_CENTRAL) {
      throw new UnextractableEpubError('bad-central-directory', `entry ${n} at ${offset}`);
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = new Uint8Array(cd, offset + 46, nameLen);
    const name = decoder.decode(nameBytes);
    entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Read + inflate one central-directory entry through the range port. */
async function readEntry(port: RangeReader, entry: CentralEntry): Promise<ArrayBuffer> {
  if (entry.compressedSize === 0) return new ArrayBuffer(0);

  // One optimistic read: local header (30 + name + a slack for the extra field)
  // plus the compressed data. If the extra field overruns the slack, re-read
  // the data range exactly.
  const guessLen = 30 + entry.name.length + LOCAL_EXTRA_SLACK + entry.compressedSize;
  const guessEnd = Math.min(port.size - 1, entry.localHeaderOffset + guessLen - 1);
  const headBuf = await port.readRange(entry.localHeaderOffset, guessEnd);
  const view = dv(headBuf);
  if (headBuf.byteLength < 30 || view.getUint32(0, true) !== SIG_LOCAL) {
    throw new UnextractableEpubError('bad-local-header', entry.name);
  }
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const dataStart = 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;

  let compressed: Uint8Array;
  if (dataEnd <= headBuf.byteLength) {
    compressed = new Uint8Array(headBuf, dataStart, entry.compressedSize);
  } else {
    const absStart = entry.localHeaderOffset + dataStart;
    const exact = await port.readRange(absStart, absStart + entry.compressedSize - 1);
    compressed = new Uint8Array(exact);
  }
  return inflate(compressed, entry.method);
}

// ── XML helpers (DOMParser; no namespace assumptions) ───────────────────────

function parseXml(bytes: ArrayBuffer): Document {
  const text = new TextDecoder().decode(bytes);
  return new DOMParser().parseFromString(text, 'application/xml');
}

function firstText(doc: Document | Element, localName: string): string | undefined {
  const el = (doc as Element).getElementsByTagNameNS?.('*', localName)?.[0];
  const text = el?.textContent?.trim();
  return text ? text : undefined;
}

/** Resolve a manifest href against the OPF's own directory, normalizing ../ . */
function resolvePath(opfPath: string, href: string): string {
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const parts = (baseDir + href).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** Find the cover manifest item's href + media-type across EPUB2/EPUB3/heuristics. */
function findCoverHref(opf: Document): { href: string; mediaType: string } | undefined {
  const items = Array.from(opf.getElementsByTagNameNS('*', 'item'));
  const byId = new Map<string, Element>();
  for (const item of items) {
    const id = item.getAttribute('id');
    if (id) byId.set(id, item);
  }
  const toResult = (item: Element | undefined): { href: string; mediaType: string } | undefined => {
    const href = item?.getAttribute('href');
    if (!href) return undefined;
    return { href, mediaType: item?.getAttribute('media-type') || 'image/jpeg' };
  };

  // EPUB3: properties="cover-image".
  const byProps = items.find((i) => (i.getAttribute('properties') || '').split(/\s+/).includes('cover-image'));
  if (byProps) return toResult(byProps);

  // EPUB2: <meta name="cover" content="{itemId}"/>.
  const metas = Array.from(opf.getElementsByTagNameNS('*', 'meta'));
  const coverMeta = metas.find((m) => m.getAttribute('name') === 'cover');
  const coverId = coverMeta?.getAttribute('content');
  if (coverId && byId.has(coverId)) return toResult(byId.get(coverId));

  // Heuristics: an image item whose id/href mentions "cover".
  const heuristic = items.find((i) => {
    const media = i.getAttribute('media-type') || '';
    if (!media.startsWith('image/')) return false;
    const id = (i.getAttribute('id') || '').toLowerCase();
    const href = (i.getAttribute('href') || '').toLowerCase();
    return id.includes('cover') || href.includes('cover');
  });
  return toResult(heuristic);
}

/**
 * Read an EPUB's metadata + cover through the range port. Fetches: the tail
 * (EOCD + central directory), META-INF/container.xml, the OPF, and the cover
 * entry — typically 3–5 small ranged reads total.
 */
export async function readRemoteEpubPreview(port: RangeReader): Promise<RemoteEpubPreview> {
  if (port.size <= 0) throw new UnextractableEpubError('eocd-not-found', 'empty file');

  // 1. Tail → EOCD → central directory.
  const tailLen = Math.min(port.size, TAIL_FETCH);
  const tailStart = port.size - tailLen;
  const tail = await port.readRange(tailStart, port.size - 1);
  const { cdOffset, cdSize, entryCount } = parseEocd(tail, tailStart);

  let cdBuf: ArrayBuffer;
  if (cdOffset >= tailStart && cdOffset + cdSize <= port.size) {
    cdBuf = tail.slice(cdOffset - tailStart, cdOffset - tailStart + cdSize);
  } else {
    cdBuf = await port.readRange(cdOffset, cdOffset + cdSize - 1);
  }
  const entries = parseCentralDirectory(cdBuf, entryCount);

  // 2. container.xml → OPF path.
  const containerEntry = entries.get('META-INF/container.xml');
  if (!containerEntry) throw new UnextractableEpubError('missing-container');
  const containerXml = parseXml(await readEntry(port, containerEntry));
  const rootfile = containerXml.getElementsByTagNameNS('*', 'rootfile')[0];
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath) throw new UnextractableEpubError('missing-opf', 'no rootfile full-path');

  // 3. OPF → metadata + cover reference.
  const opfEntry = entries.get(opfPath);
  if (!opfEntry) throw new UnextractableEpubError('missing-opf', opfPath);
  const opf = parseXml(await readEntry(port, opfEntry));

  const identifiers = Array.from(opf.getElementsByTagNameNS('*', 'identifier'))
    .map((el) => el.textContent?.trim())
    .filter((v): v is string => !!v);

  const preview: RemoteEpubPreview = {
    title: firstText(opf, 'title'),
    author: firstText(opf, 'creator'),
    description: firstText(opf, 'description'),
    language: firstText(opf, 'language'),
    identifiers,
  };

  // 4. Cover — best effort; a missing/failed cover never fails the preview.
  const coverRef = findCoverHref(opf);
  if (coverRef) {
    const coverPath = resolvePath(opfPath, coverRef.href);
    const coverEntry = entries.get(coverPath);
    if (coverEntry) {
      try {
        const bytes = await readEntry(port, coverEntry);
        if (bytes.byteLength > 0) preview.cover = { bytes, mediaType: coverRef.mediaType };
      } catch {
        // Cover inflate/read failure is non-fatal: keep the metadata preview.
      }
    }
  }

  return preview;
}
