import { describe, it, expect } from 'vitest';
import { chooseCover, findCoverCandidates, imagesInDocument, isPlausibleCoverSize } from './coverResolver';
import { PackageIndex } from './packageIndex';
import type { PackageModel } from './packageModel';

describe('imagesInDocument', () => {
  it('lists <img> and SVG <image> in document order, resolved against the document', () => {
    const doc = `<html xmlns="http://www.w3.org/1999/xhtml"><body>
      <img src="../img/a.jpg"/>
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="b.png"/></svg>
      <img src="data:image/png;base64,AAAA"/><img src="https://example.com/c.png"/><img src="../img/a.jpg"/>
    </body></html>`;
    expect(imagesInDocument(doc, 'Text/cover.xhtml')).toEqual(['img/a.jpg', 'Text/b.png']);
  });
});

describe('isPlausibleCoverSize', () => {
  it.each([
    [300, 450, true],
    [600, 600, true],
    [32, 32, false], // icon
    [400, 100, false], // logo strip
    [500, 400, false], // landscape plate
    [100, 900, false], // too narrow
  ])('%ix%i → %s', (w, h, ok) => {
    expect(isPlausibleCoverSize(w, h)).toBe(ok);
  });
});

describe('findCoverCandidates', () => {
  const model = (over: Partial<PackageModel>): PackageModel => ({
    opfPath: 'content.opf',
    opfDir: '',
    manifest: [],
    spine: [],
    guide: [],
    ...over,
  });

  it('declaredOnly stops before opening any spine document', async () => {
    const reads: string[] = [];
    const index = new PackageIndex(
      model({
        manifest: [
          { id: 'c', href: 'cover.xhtml', mediaType: 'application/xhtml+xml', properties: [] },
          { id: 'i', href: 'i.png', mediaType: 'image/png', properties: [] },
        ],
        spine: ['cover.xhtml'],
      }),
    );
    const out = await findCoverCandidates(
      index,
      { readText: async (p) => (reads.push(p), '<html><body><img src="i.png"/></body></html>') },
      { declaredOnly: true },
    );
    expect(out).toEqual([]);
    expect(reads).toEqual([]);
  });

  it('C4: a meta cover naming a file by href resolves through the manifest', async () => {
    const index = new PackageIndex(
      model({
        manifest: [{ id: 'img1', href: 'images/c%20v.jpg', mediaType: 'image/jpeg', properties: [] }],
        metaCover: 'images/c v.jpg',
      }),
    );
    const out = await findCoverCandidates(index, { readText: async () => undefined });
    expect(out).toEqual([{ href: 'images/c%20v.jpg', mediaType: 'image/jpeg', reason: 'meta-cover', explicit: true }]);
  });
});

describe('chooseCover', () => {
  const candidate = (href: string, explicit = false) => ({
    href,
    mediaType: 'image/png',
    reason: (explicit ? 'meta-cover' : 'document-image') as 'meta-cover' | 'document-image',
    explicit,
  });
  const blob = new Blob([new Uint8Array([1])]);

  it('waives the size check for an explicitly declared cover', async () => {
    const choice = await chooseCover([candidate('wide.png', true)], async () => blob, async () => ({ width: 800, height: 300 }));
    expect(choice.pick?.candidate.href).toBe('wide.png');
  });

  it('rejects missing, undecodable, implausible and unverifiable candidates in turn', async () => {
    const choice = await chooseCover(
      [candidate('missing.png'), candidate('bad.png'), candidate('logo.png'), candidate('anon.png'), candidate('ok.png')],
      async (c) => (c.href === 'missing.png' ? undefined : blob),
      async () => 'unknown',
    );
    expect(choice.pick).toBeUndefined();
    expect(choice.rejected.map((r) => r.why)).toEqual(['missing', 'unverifiable', 'unverifiable', 'unverifiable', 'unverifiable']);

    // Probed in order: corrupt bytes, a logo strip, a real cover.
    const sizes: Array<'undecodable' | { width: number; height: number }> = [
      'undecodable',
      { width: 400, height: 100 },
      { width: 300, height: 450 },
    ];
    const sized = await chooseCover(
      [candidate('bad.png'), candidate('logo.png'), candidate('ok.png')],
      async () => blob,
      async () => sizes.shift() ?? 'undecodable',
    );
    expect(sized.rejected.map((r) => [r.candidate.href, r.why])).toEqual([
      ['bad.png', 'undecodable'],
      ['logo.png', 'implausible-size'],
    ]);
    expect(sized.pick).toMatchObject({ candidate: { href: 'ok.png' }, width: 300, height: 450 });
  });
});
