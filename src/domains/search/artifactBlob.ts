/**
 * Codec for the cloud blob that carries a book's embeddings between the user's
 * devices. Pure and store-free: it turns an embedding-space stamp into a
 * content-addressing key, serializes an embeddings row into a self-describing
 * byte blob ({@link serializeArtifactBlob}), and parses that blob back
 * ({@link parseArtifactBlob}) — exact inverses sharing the header types and byte
 * layout defined here. The app layer reads the stores/manifest and injects the
 * bytes; this module never touches a store.
 *
 * ── contentKey ─────────────────────────────────────────────────────────────
 * The whole-book key that addresses a blob in the shared cache:
 *   contentKey = sha256hex(contentHash | model | dims | quant | extractionVersion)
 * `contentHash` is the EPUB's content identity; the rest is the embedding-space
 * stamp. A change in ANY field yields a different key, so embeddings made for a
 * different model/dimensionality are simply a different object — a miss, never
 * silently reinterpreted.
 *
 * ── Byte layout ─────────────────────────────────────────────────────────────
 *   [headerLen: u32 little-endian]
 *   [header JSON: UTF-8, headerLen bytes]
 *   [packed body: per-section int8 vectors then float32 scales, concatenated
 *    in the header's `sections` order]
 *
 * Each section's `{byteOffset, byteLen}` addresses its slice of the packed body
 * (relative to the body start, i.e. AFTER the u32 + JSON header). Inside a
 * section slice the int8 vectors come FIRST (`vectorsByteLen` bytes) and the
 * float32 scales SECOND (the remainder, `byteLen - vectorsByteLen`); the float32
 * scales region is 4-byte aligned because each section slice begins on a 4-byte
 * boundary (the writer pads — and {@link parseArtifactBlob} slices rather than
 * reinterpret-casts, so a misaligned read cannot occur regardless).
 */
import type { CacheEmbeddingsRow } from '@data/rows/cache';

/**
 * The embedding-space stamp baked into {@link contentKey} and re-checked when a
 * blob is downloaded. A change in any field yields a different key, so a blob
 * from a different embedding space is a miss, never reinterpreted.
 */
export interface ArtifactStamp {
  model: string;
  dims: number;
  quant: 'int8-pervec';
  extractionVersion: number;
}

/** SHA-256 (hex) of the stamped content identity — the whole-book artifact key. */
export async function contentKey(args: { contentHash: string } & ArtifactStamp): Promise<string> {
  const material = `${args.contentHash}|${args.model}|${args.dims}|${args.quant}|${args.extractionVersion}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The self-describing header carried in the blob: the embedding-space stamp
 * (re-derived into a {@link contentKey} on download to catch a corrupted/wrong
 * object) plus the per-section index. `sectionTextHash` lets a book whose text
 * has partially changed reconcile section-by-section on download (keep the
 * matching sections, re-embed only the diverged ones). `byteOffset`/`byteLen`
 * address the section's slice of the packed body; `vectorsByteLen` splits that
 * slice into the int8 vectors (first) and the float32 scales (rest).
 */
export interface ArtifactBlobHeader {
  /** Header schema version — bumped if this layout ever changes. */
  headerVersion: 1;
  model: string;
  dims: number;
  quant: 'int8-pervec';
  extractionVersion: number;
  sections: {
    href: string;
    sectionTextHash: string;
    /** Byte offset of this section's slice within the packed body. */
    byteOffset: number;
    /** Total byte length of this section's slice (int8 vectors + float32 scales). */
    byteLen: number;
    /** Byte length of the int8-vectors prefix inside the slice (scales follow). */
    vectorsByteLen: number;
  }[];
}

/** The current header layout version. */
export const ARTIFACT_HEADER_VERSION = 1 as const;

/** Parsed view of a section's bytes (independently-owned ArrayBuffers). */
export interface ArtifactSectionBytes {
  vectors: ArrayBuffer;
  scales: ArrayBuffer;
}

/**
 * Parse a header-format blob into its header + a per-section byte accessor.
 *
 * Reads `[headerLen u32 LE][JSON header][packed body]`; `sectionBytes(href)`
 * returns the section's int8 vectors and float32 scales as independently-owned
 * ArrayBuffers (`.slice` — never a reinterpret-cast over the source buffer, so
 * the read is alignment-safe and the caller can persist the buffers directly).
 * Throws on a structurally invalid blob (too small, bad headerLen, unknown
 * version, out-of-range section span) so the caller treats a corrupt download as
 * a miss and falls back to re-embedding.
 */
export function parseArtifactBlob(bytes: ArrayBuffer): {
  header: ArtifactBlobHeader;
  sectionBytes(href: string): ArtifactSectionBytes | undefined;
} {
  if (bytes.byteLength < 4) {
    throw new Error('artifactBlob: buffer too small to hold the header length');
  }
  const view = new DataView(bytes);
  const headerLen = view.getUint32(0, true);
  const headerStart = 4;
  const bodyStart = headerStart + headerLen;
  if (bodyStart > bytes.byteLength) {
    throw new Error(`artifactBlob: header length ${headerLen} exceeds buffer`);
  }

  const headerJson = new TextDecoder().decode(new Uint8Array(bytes, headerStart, headerLen));
  let header: ArtifactBlobHeader;
  try {
    header = JSON.parse(headerJson) as ArtifactBlobHeader;
  } catch {
    throw new Error('artifactBlob: header JSON is not parseable');
  }
  if (header.headerVersion !== ARTIFACT_HEADER_VERSION) {
    throw new Error(`artifactBlob: unsupported header version ${String(header.headerVersion)}`);
  }
  if (!Array.isArray(header.sections)) {
    throw new Error('artifactBlob: header is missing the sections index');
  }

  const bodyLen = bytes.byteLength - bodyStart;
  const byHref = new Map<string, ArtifactBlobHeader['sections'][number]>();
  for (const s of header.sections) {
    if (
      s.byteOffset < 0 ||
      s.vectorsByteLen < 0 ||
      s.vectorsByteLen > s.byteLen ||
      s.byteOffset + s.byteLen > bodyLen
    ) {
      throw new Error(`artifactBlob: section ${s.href} span is out of range`);
    }
    byHref.set(s.href, s);
  }

  return {
    header,
    sectionBytes(href: string): ArtifactSectionBytes | undefined {
      const s = byHref.get(href);
      if (!s) return undefined;
      const sliceStart = bodyStart + s.byteOffset;
      const vectorsEnd = sliceStart + s.vectorsByteLen;
      const sliceEnd = sliceStart + s.byteLen;
      return {
        vectors: bytes.slice(sliceStart, vectorsEnd),
        scales: bytes.slice(vectorsEnd, sliceEnd),
      };
    },
  };
}

/**
 * View a section binary as raw bytes WITHOUT reinterpreting elements. The row's
 * `vectors`/`scales` are typed `ArrayBuffer` (the persisted shape), but the
 * embeddings repo's read path hands back re-wrapped Int8Array/Float32Array
 * views; either is byte-copied here over its own `buffer`/`byteOffset`/
 * `byteLength` (NOT `new Uint8Array(floatArray)`, which would copy float values
 * as integers).
 */
function asBytes(bin: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (ArrayBuffer.isView(bin)) {
    return new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);
  }
  return new Uint8Array(bin);
}

/**
 * The serializer's input shape: a `cache_embeddings` row whose section binaries
 * may be raw ArrayBuffers (the persisted {@link CacheEmbeddingsRow}) OR the
 * repo's re-wrapped typed-array views (the read path) — both byte-read via
 * {@link asBytes}. Stamp fields are reused from {@link CacheEmbeddingsRow}.
 */
export type SerializableEmbeddingRow = Pick<
  CacheEmbeddingsRow,
  'model' | 'dims' | 'quant' | 'extractionVersion'
> & {
  sections: {
    href: string;
    sectionTextHash: string;
    vectors: ArrayBuffer | ArrayBufferView;
    scales: ArrayBuffer | ArrayBufferView;
  }[];
};

/**
 * Serialize an embeddings row into the blob the {@link parseArtifactBlob} reader
 * consumes — the exact inverse of the parse side, byte-for-byte to the layout
 * documented at the top of this file.
 *
 * The body concatenates, per section in row order, the int8 vectors FIRST
 * (`section.vectors`) then the float32 scales SECOND (`section.scales`), padding
 * so the next section slice begins on a 4-byte boundary (keeping the scales
 * region 4-byte aligned, matching the parse side's alignment-safe slicing). The
 * header stamp ({model, dims, quant, extractionVersion}) comes from the ROW, not
 * live config, so the published blob is keyed by what was actually embedded; a
 * row in a stale embedding space is re-embedded before it ever reaches here, so
 * the writer's and reader's content keys stay aligned.
 *
 * Pure and store-free: bytes are read off the row's buffers (honoring
 * `byteOffset`/`byteLength` whether the row carries raw ArrayBuffers or the
 * repo's re-wrapped typed-array views) with no re-quantization.
 *
 * Accepts both the persisted {@link CacheEmbeddingsRow} (binaries are
 * ArrayBuffers) AND the embeddings repo's read view (binaries are
 * Int8Array/Float32Array) via the {@link SerializableEmbeddingRow} structural
 * type, so the caller can pass `embeddingsRepo.get(...)` straight through.
 */
export function serializeArtifactBlob(row: SerializableEmbeddingRow): ArrayBuffer {
  const bodyChunks: Uint8Array[] = [];
  const headerSections: ArtifactBlobHeader['sections'] = [];
  let offset = 0;
  for (const s of row.sections) {
    // Read the raw bytes off whatever buffers the row carries (the persisted
    // ArrayBuffers, or the repo's re-wrapped Int8Array/Float32Array views) —
    // {@link asBytes} honors byteOffset/byteLength so a shared backing buffer
    // cannot leak neighboring bytes, and never reinterprets float ELEMENTS as
    // bytes (a Uint8Array OVER a Float32Array's buffer, not FROM its values).
    const vectorBytes = asBytes(s.vectors);
    const scaleBytes = asBytes(s.scales);
    const sliceLen = vectorBytes.byteLength + scaleBytes.byteLength;
    const slice = new Uint8Array(sliceLen);
    slice.set(vectorBytes, 0);
    slice.set(scaleBytes, vectorBytes.byteLength);
    headerSections.push({
      href: s.href,
      sectionTextHash: s.sectionTextHash,
      byteOffset: offset, // position of this slice within the packed body
      byteLen: sliceLen,
      vectorsByteLen: vectorBytes.byteLength,
    });
    bodyChunks.push(slice);
    offset += sliceLen;
    // Pad to a 4-byte boundary before the next slice.
    const pad = (4 - (offset % 4)) % 4;
    if (pad > 0) {
      bodyChunks.push(new Uint8Array(pad));
      offset += pad;
    }
  }
  const body = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of bodyChunks) {
    body.set(chunk, cursor);
    cursor += chunk.byteLength;
  }

  const header: ArtifactBlobHeader = {
    headerVersion: ARTIFACT_HEADER_VERSION,
    model: row.model,
    dims: row.dims,
    quant: row.quant,
    extractionVersion: row.extractionVersion,
    sections: headerSections,
  };
  const headerJson = new TextEncoder().encode(JSON.stringify(header));
  const bytes = new Uint8Array(4 + headerJson.byteLength + body.byteLength);
  new DataView(bytes.buffer).setUint32(0, headerJson.byteLength, true);
  bytes.set(headerJson, 4);
  bytes.set(body, 4 + headerJson.byteLength);
  return bytes.buffer;
}
