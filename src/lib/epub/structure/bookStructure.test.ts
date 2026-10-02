/**
 * End-to-end over the pure resolvers with the malformed-EPUB corpus: every
 * fixture in `@test/harness/epubFixtures` must produce exactly its expected
 * TOC (hrefs, labels, greyed entries) and cover.
 */
import { describe, it, expect } from 'vitest';
import {
  MALFORMED_EPUB_FIXTURES,
  fixtureArchive,
  flattenToc,
  probePngHeader,
} from '@test/harness/epubFixtures';
import { readBookStructure, resolveStructureCover, resolveStructureToc } from './bookStructure';

describe.each(MALFORMED_EPUB_FIXTURES.map((f) => [f.name, f] as const))('fixture %s', (_name, fixture) => {
  it(`resolves the TOC (${fixture.covers.filter((c) => c.startsWith('T')).join(', ')})`, async () => {
    const structure = await readBookStructure(fixtureArchive(fixture), fixture.opfPath);
    expect(structure).not.toBeNull();
    const titles = new Map(Object.entries(fixture.expected.chapterTitles ?? {}));
    const choice = resolveStructureToc(structure!, titles);
    expect(choice.source).toBe(fixture.expected.tocSource);
    expect(flattenToc(choice.toc)).toEqual(fixture.expected.toc);
  });

  it(`finds the cover (${fixture.covers.filter((c) => c.startsWith('C')).join(', ')})`, async () => {
    const archive = fixtureArchive(fixture);
    const structure = await readBookStructure(archive, fixture.opfPath);
    const result = await resolveStructureCover(structure!, archive, probePngHeader);
    expect(result.pick?.candidate.href ?? null).toBe(fixture.expected.cover);
    expect(result.pick?.blob.size).toBeGreaterThan(0);
  });
});

describe('cover validation details', () => {
  const byName = (name: string) => MALFORMED_EPUB_FIXTURES.find((f) => f.name === name)!;

  it('C7: rejects a corrupt declared cover and a logo before taking the named image', async () => {
    const fixture = byName('cover-meta-href-corrupt');
    const archive = fixtureArchive(fixture);
    const result = await resolveStructureCover((await readBookStructure(archive, fixture.opfPath))!, archive, probePngHeader);
    expect(result.rejected.map((r) => [r.candidate.href, r.why])).toEqual([
      ['Images/broken.jpg', 'undecodable'],
      ['Images/logo.png', 'implausible-size'],
    ]);
    expect(result.pick?.candidate.reason).toBe('named-image');
  });

  it('C1: the cover page wins over decoy logo and social icons', async () => {
    const fixture = byName('nav-subfolder-undeclared-cover');
    const archive = fixtureArchive(fixture);
    const result = await resolveStructureCover((await readBookStructure(archive, fixture.opfPath))!, archive, probePngHeader);
    expect(result.pick?.candidate).toMatchObject({ reason: 'cover-document', via: 'Text/cover.xhtml' });
    // The decoys are still listed (validation, not listing, keeps them out).
    expect(result.candidates.map((c) => c.href)).toEqual(
      expect.arrayContaining(['Images/facebook.png', 'Images/Publisher_Logo.png']),
    );
  });

  it('without a platform decoder, trusts declared/cover-named candidates only', async () => {
    const fixture = byName('nav-subfolder-undeclared-cover');
    const archive = fixtureArchive(fixture);
    const result = await resolveStructureCover(
      (await readBookStructure(archive, fixture.opfPath))!,
      archive,
      async () => 'unknown',
    );
    expect(result.pick?.candidate.href).toBe('Images/img-0001.png');
  });

  it('skips nav/NCX reads when only the cover is wanted', async () => {
    const fixture = byName('nav-subfolder-undeclared-cover');
    const archive = fixtureArchive(fixture);
    const structure = await readBookStructure(archive, fixture.opfPath, { toc: false });
    expect(structure?.nav).toBeNull();
    expect(archive.reads).toEqual(['OEBPS/content.opf']);
  });

  it('returns null for a missing OPF', async () => {
    const fixture = byName('href-variants');
    expect(await readBookStructure(fixtureArchive(fixture), 'nope.opf')).toBeNull();
  });
});
