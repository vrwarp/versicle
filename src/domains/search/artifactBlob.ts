/**
 * Artifact-blob codec (shared-ai-cache-design.md §2.2/§2.6) — the PURE,
 * store-free content-addressing key + self-describing blob header for the
 * shared AI-cache "Artifact Lane". Phase B implements ONLY the PARSE side
 * (download/consult); the SERIALIZE side is Phase C (the ArtifactPublisher
 * upload boot task) and reuses the exact header types + byte layout pinned
 * here verbatim.
 *
 * No store/IDB import (domains-no-store holds): the app layer reads the
 * stores/manifest and injects the bytes; this module only turns a stamp into a
 * key and a byte buffer into a header + per-section vector views.
 *
 * ── contentKey ─────────────────────────────────────────────────────────────
 * The whole-book bundle key (§2.2):
 *   contentKey = sha256hex(contentHash | model | dims | quant | extractionVersion)
 * `contentHash` is the EPUB's content identity (static.ts:67), the rest the
 * embedding-space stamp — a change in ANY field yields a different key, so a
 * stale-space blob is a structural miss (a different object), never converted.
 * The hex digest mirrors identity.ts:54-59 (crypto.subtle.digest('SHA-256')).
 *
 * ── Byte layout (versioned Cloud format; Phase C serializes to it) ──────────
 *   [headerLen: u32 little-endian]
 *   [header JSON: UTF-8, headerLen bytes]
 *   [packed body: per-section int8 vectors then float32 scales, concatenated
 *    in the header's `sections` order]
 *
 * Each section's `{byteOffset, byteLen}` address its slice of the packed body
 * (relative to the body start, i.e. AFTER the u32 + JSON header). Inside a
 * section slice the int8 vectors come FIRST (`vectorsByteLen` bytes) and the
 * float32 scales SECOND (the remainder, `byteLen - vectorsByteLen`); the
 * float32 scales region is 4-byte aligned because each section slice begins on
 * a 4-byte boundary (the writer pads — see {@link parseArtifactBlob} which
 * slices, never reinterpret-casts, so a misaligned read cannot occur).
 */

/**
 * The embedding-space stamp baked into {@link contentKey} and re-asserted on
 * consult (§2.2). A change in any field → a different key → a structural miss.
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
 * The self-describing header carried in the blob (§2.2): the embedding-space
 * stamp (re-derived into a {@link contentKey} on consult as a bit-rot guard)
 * plus the per-section index. `sectionTextHash` lets a partially re-extracted
 * book reconcile section-by-section on download (drop the diverged sections,
 * re-embed only those). `byteOffset`/`byteLen` address the section's slice of
 * the packed body; `vectorsByteLen` splits that slice into the int8 vectors
 * (first) and the float32 scales (rest).
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
 * version, out-of-range section span) so the consult treats a corrupt object as
 * a definitive non-hit at the app layer.
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
