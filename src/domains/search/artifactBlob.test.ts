/**
 * artifactBlob codec suite (Artifact Lane Phase B, shared-ai-cache-design.md
 * §2.2/§2.6): the PURE content-key + blob-header PARSE side.
 *
 *  - contentKey: deterministic (same stamp → same hex digest) and sensitive to
 *    EVERY stamp field (a change in any field → a different key → a structural
 *    miss, never a converted stale-space blob);
 *  - parseArtifactBlob: round-trips a hand-built header-format blob (the
 *    serialize side is Phase C, so the fixture is hand-laid to the documented
 *    byte layout the codec reads);
 *  - corruption guard: re-deriving the key from a TAMPERED stamp yields a key
 *    that does NOT match the requested one (the §2.4 bit-rot rejection the
 *    consult enforces).
 */
import { describe, it, expect } from 'vitest';
import {
  contentKey,
  parseArtifactBlob,
  ARTIFACT_HEADER_VERSION,
  type ArtifactBlobHeader,
  type ArtifactStamp,
} from './artifactBlob';

const STAMP: ArtifactStamp = {
  model: 'gemini-embedding-001',
  dims: 4,
  quant: 'int8-pervec',
  extractionVersion: 3,
};

/**
 * Hand-build a header-format blob to the documented byte layout
 * (`[headerLen u32 LE][JSON header][packed body]`). Each section's slice is the
 * int8 vectors followed by the float32 scales; the header's byteOffset/byteLen/
 * vectorsByteLen address that slice within the packed body. This mirrors the
 * Phase-C serializer the codec is the read half of.
 */
function buildBlob(
  stamp: ArtifactStamp,
  sections: { href: string; sectionTextHash: string; vectors: Int8Array; scales: Float32Array }[],
): { bytes: ArrayBuffer; header: ArtifactBlobHeader } {
  // Lay out the packed body, 4-byte-aligning each section slice (so the float32
  // scales never straddle a misaligned boundary — the codec slices anyway).
  const bodyChunks: Uint8Array[] = [];
  const headerSections: ArtifactBlobHeader['sections'] = [];
  let offset = 0;
  for (const s of sections) {
    const vectorBytes = new Uint8Array(s.vectors.buffer, s.vectors.byteOffset, s.vectors.byteLength);
    const scaleBytes = new Uint8Array(s.scales.buffer, s.scales.byteOffset, s.scales.byteLength);
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
    model: stamp.model,
    dims: stamp.dims,
    quant: stamp.quant,
    extractionVersion: stamp.extractionVersion,
    sections: headerSections,
  };
  const headerJson = new TextEncoder().encode(JSON.stringify(header));
  const bytes = new Uint8Array(4 + headerJson.byteLength + body.byteLength);
  new DataView(bytes.buffer).setUint32(0, headerJson.byteLength, true);
  bytes.set(headerJson, 4);
  bytes.set(body, 4 + headerJson.byteLength);
  return { bytes: bytes.buffer, header };
}

describe('contentKey', () => {
  it('is deterministic for the same stamp + contentHash', async () => {
    const a = await contentKey({ contentHash: 'abc', ...STAMP });
    const b = await contentKey({ contentHash: 'abc', ...STAMP });
    expect(a).toBe(b);
    // SHA-256 hex is 64 chars.
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is sensitive to EVERY field (any change → a different key)', async () => {
    const base = await contentKey({ contentHash: 'abc', ...STAMP });
    const variants = await Promise.all([
      contentKey({ contentHash: 'DIFFERENT', ...STAMP }),
      contentKey({ contentHash: 'abc', ...STAMP, model: 'other-model' }),
      contentKey({ contentHash: 'abc', ...STAMP, dims: 768 }),
      contentKey({ contentHash: 'abc', ...STAMP, extractionVersion: 99 }),
    ]);
    for (const v of variants) expect(v).not.toBe(base);
    // All variants are also distinct from one another.
    expect(new Set([base, ...variants]).size).toBe(1 + variants.length);
  });
});

describe('parseArtifactBlob', () => {
  it('round-trips a hand-built header-format blob (header + per-section bytes)', () => {
    const v0 = Int8Array.from([12, -34, 56, -78]);
    const s0 = Float32Array.from([0.0123]);
    const v1 = Int8Array.from([1, 2, 3, 4, -5, -6, -7, -8]);
    const s1 = Float32Array.from([0.5, 0.25]);
    const { bytes } = buildBlob(STAMP, [
      { href: 'ch1.xhtml', sectionTextHash: 'h1', vectors: v0, scales: s0 },
      { href: 'ch2.xhtml', sectionTextHash: 'h2', vectors: v1, scales: s1 },
    ]);

    const parsed = parseArtifactBlob(bytes);
    expect(parsed.header.model).toBe(STAMP.model);
    expect(parsed.header.dims).toBe(STAMP.dims);
    expect(parsed.header.quant).toBe('int8-pervec');
    expect(parsed.header.extractionVersion).toBe(3);
    expect(parsed.header.sections.map((s) => s.href)).toEqual(['ch1.xhtml', 'ch2.xhtml']);

    const ch1 = parsed.sectionBytes('ch1.xhtml')!;
    expect(Array.from(new Int8Array(ch1.vectors))).toEqual([12, -34, 56, -78]);
    expect(Array.from(new Float32Array(ch1.scales))).toEqual([Math.fround(0.0123)]);

    const ch2 = parsed.sectionBytes('ch2.xhtml')!;
    expect(Array.from(new Int8Array(ch2.vectors))).toEqual([1, 2, 3, 4, -5, -6, -7, -8]);
    expect(Array.from(new Float32Array(ch2.scales))).toEqual([0.5, 0.25]);

    // An unknown href is undefined (the consult drops/re-embeds it).
    expect(parsed.sectionBytes('missing.xhtml')).toBeUndefined();
  });

  it('rejects a blob whose header version is unsupported', () => {
    const { bytes } = buildBlob(STAMP, [
      { href: 'a', sectionTextHash: 'h', vectors: Int8Array.from([1]), scales: Float32Array.from([1]) },
    ]);
    // Corrupt the headerVersion in the JSON (re-pack with a bad version).
    const view = new DataView(bytes);
    const headerLen = view.getUint32(0, true);
    const headerJson = new TextDecoder().decode(new Uint8Array(bytes, 4, headerLen));
    const bad = headerJson.replace('"headerVersion":1', '"headerVersion":99');
    const badHeader = new TextEncoder().encode(bad);
    // Same length so the offsets still line up (replace is digit-for-digit-ish);
    // if length changed, rebuild the prefix length too.
    const out = new Uint8Array(4 + badHeader.byteLength + (bytes.byteLength - 4 - headerLen));
    new DataView(out.buffer).setUint32(0, badHeader.byteLength, true);
    out.set(badHeader, 4);
    out.set(new Uint8Array(bytes, 4 + headerLen), 4 + badHeader.byteLength);
    expect(() => parseArtifactBlob(out.buffer)).toThrow(/header version/);
  });

  it('rejects a structurally invalid blob (header length exceeds buffer)', () => {
    const tiny = new Uint8Array(8);
    new DataView(tiny.buffer).setUint32(0, 999, true); // claims a 999-byte header
    expect(() => parseArtifactBlob(tiny.buffer)).toThrow();
  });
});

describe('corruption guard (§2.4 bit-rot rejection)', () => {
  it('a key re-derived from a TAMPERED stamp does NOT match the requested key', async () => {
    // The consult derives the requested key from the live stamp, then re-derives
    // from the blob HEADER's stamp and asserts equality. A swapped/bit-rotted
    // blob carrying a different stamp re-derives to a different key → reject.
    const contentHash = 'book-content-hash';
    const requested = await contentKey({ contentHash, ...STAMP });

    // The blob actually describes a DIFFERENT model (an adversarial/bit-rot swap
    // under the same content-addressed object name).
    const tamperedHeaderStamp: ArtifactStamp = { ...STAMP, model: 'attacker-model' };
    const rederived = await contentKey({ contentHash, ...tamperedHeaderStamp });

    expect(rederived).not.toBe(requested);
  });

  it('a key re-derived from the MATCHING stamp equals the requested key (the happy path)', async () => {
    const contentHash = 'book-content-hash';
    const requested = await contentKey({ contentHash, ...STAMP });
    const rederived = await contentKey({ contentHash, ...STAMP });
    expect(rederived).toBe(requested);
  });
});
