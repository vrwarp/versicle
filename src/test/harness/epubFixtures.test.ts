/**
 * Drift gate for the committed malformed-EPUB corpus: every fixture under
 * `verification/fixtures/malformed/` must be byte-identical to what
 * `buildFixtureEpub` produces from its spec, so the Playwright journey and
 * the unit tests always exercise the same books.
 *
 * Regenerate after editing a spec: `npm run fixtures:epub`.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { MALFORMED_EPUB_FIXTURES, buildFixtureEpub, makePng, probePngHeader } from './epubFixtures';

const DIR = join(process.cwd(), 'verification/fixtures/malformed');
const REGEN = process.env.REGEN_EPUB_FIXTURES === '1';

describe('malformed EPUB fixture corpus', () => {
  it.each(MALFORMED_EPUB_FIXTURES.map((f) => [f.name, f] as const))('%s.epub is current', async (name, fixture) => {
    const bytes = await buildFixtureEpub(fixture);
    const file = join(DIR, `${name}.epub`);
    if (REGEN) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(file, bytes);
    }
    expect(existsSync(file), `${file} missing — run npm run fixtures:epub`).toBe(true);
    expect(Buffer.from(readFileSync(file)).equals(Buffer.from(bytes)), `${name}.epub drifted — run npm run fixtures:epub`).toBe(
      true,
    );
  });

  it('has no stale files', () => {
    const expected = new Set(MALFORMED_EPUB_FIXTURES.map((f) => `${f.name}.epub`));
    expect(readdirSync(DIR).filter((f) => !expected.has(f))).toEqual([]);
  });

  it('builds a valid EPUB container (mimetype first and stored)', async () => {
    const zip = await JSZip.loadAsync(await buildFixtureEpub(MALFORMED_EPUB_FIXTURES[0]));
    expect(Object.keys(zip.files)[0]).toBe('mimetype');
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip');
  });

  it('builds deterministically', async () => {
    const [a, b] = await Promise.all([
      buildFixtureEpub(MALFORMED_EPUB_FIXTURES[1]),
      buildFixtureEpub(MALFORMED_EPUB_FIXTURES[1]),
    ]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('encodes PNGs with the requested dimensions', async () => {
    expect(await probePngHeader(new Blob([makePng(300, 450) as BlobPart]))).toEqual({ width: 300, height: 450 });
    expect(await probePngHeader(new Blob([new Uint8Array([1, 2, 3])]))).toBe('undecodable');
  });
});
