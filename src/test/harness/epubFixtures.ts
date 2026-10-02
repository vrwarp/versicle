/**
 * Malformed-EPUB fixture corpus (plan/epub-toc-cover-hardening.md §7).
 *
 * Each fixture is a hand-written archive reproducing one family of real-world
 * packaging defects from the plan's taxonomy (T1–T9 TOC, C1–C8 cover), with
 * the outcome the resolvers must produce. The same specs feed:
 *
 *  - unit tests (`src/lib/epub/structure/*.test.ts`) via `buildFixtureEpub`;
 *  - the committed `.epub` files under `verification/fixtures/malformed/`
 *    the Playwright journey imports — kept byte-identical to this builder by
 *    the drift gate in `epubFixtures.test.ts` (`npm run fixtures:epub`
 *    regenerates them).
 *
 * Everything is deterministic (fixed zip dates, pure-JS PNG encoder) so the
 * committed bytes only change when a spec does.
 */
import JSZip from 'jszip';

// ── Images ──────────────────────────────────────────────────────────────────

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function chunk(type: string, data: Uint8Array): number[] {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** zlib stream of stored (uncompressed) deflate blocks — no zlib dependency. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01];
  for (let pos = 0; pos < raw.length || pos === 0; pos += 65535) {
    const len = Math.min(65535, raw.length - pos);
    const final = pos + len >= raw.length ? 1 : 0;
    out.push(final, len & 0xff, len >>> 8, ~len & 0xff, (~len >>> 8) & 0xff);
    for (let i = 0; i < len; i++) out.push(raw[pos + i]);
    if (len === 0) break;
  }
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  out.push(...u32(((b << 16) | a) >>> 0));
  return new Uint8Array(out);
}

/**
 * A real, decodable 8-bit grayscale PNG of `width`×`height`: a vertical
 * gradient around `shade` with a border, so it is visibly an image when the
 * journey screenshots the library.
 */
export function makePng(width: number, height: number, shade = 128): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width + 1);
    raw[row] = 0; // filter: none
    const tone = Math.max(0, Math.min(255, shade - 40 + Math.round((80 * y) / Math.max(1, height - 1))));
    for (let x = 0; x < width; x++) {
      const border = x < 6 || y < 6 || x >= width - 6 || y >= height - 6;
      raw[row + 1 + x] = border ? 30 : tone;
    }
  }
  const ihdr = new Uint8Array([...u32(width), ...u32(height), 8, 0, 0, 0, 0]);
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', zlibStored(raw)),
    ...chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Bytes that carry a `.jpg` name but decode as nothing (C7). */
const CORRUPT_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xde, 0xad]);

/**
 * Test-side image probe: reads PNG IHDR dimensions, 'undecodable' for
 * anything else. Lets unit tests exercise size validation without a
 * platform decoder (jsdom has no createImageBitmap).
 */
export async function probePngHeader(blob: Blob): Promise<{ width: number; height: number } | 'undecodable'> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sig = [0x89, 0x50, 0x4e, 0x47];
  if (bytes.length < 24 || !sig.every((b, i) => bytes[i] === b)) return 'undecodable';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

// ── Markup helpers ──────────────────────────────────────────────────────────

function xhtml(title: string, body: string, bodyAttrs = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title></head>
<body${bodyAttrs ? ` ${bodyAttrs}` : ''}>
${body}
</body>
</html>`;
}

/** A chapter with enough prose for import's sentence extraction. */
function chapter(heading: string, n: number, extra = ''): string {
  const p = (i: number) =>
    `<p>This is paragraph ${i} of section ${n}. The quick brown fox jumps over the lazy dog while the narrator explains what happens next in some detail.</p>`;
  return xhtml(heading, `<h1>${heading}</h1>\n${p(1)}\n${p(2)}\n${extra}${p(3)}`);
}

interface ManifestSpec {
  id: string;
  href: string;
  type: string;
  properties?: string;
}

function opf(o: {
  version?: '2.0' | '3.0';
  title: string;
  manifest: ManifestSpec[];
  spine: string[];
  tocId?: string;
  meta?: string;
  guide?: string;
}): string {
  const items = o.manifest
    .map((m) => `    <item id="${m.id}" href="${m.href}" media-type="${m.type}"${m.properties ? ` properties="${m.properties}"` : ''}/>`)
    .join('\n');
  const refs = o.spine.map((id) => `    <itemref idref="${id}"/>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<package version="${o.version ?? '3.0'}" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${o.title}</dc:title>
    <dc:creator>Versicle Fixtures</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">urn:uuid:versicle-fixture-${o.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}</dc:identifier>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>${o.meta ? `\n    ${o.meta}` : ''}
  </metadata>
  <manifest>
${items}
  </manifest>
  <spine${o.tocId ? ` toc="${o.tocId}"` : ''}>
${refs}
  </spine>${o.guide ? `\n  <guide>\n    ${o.guide}\n  </guide>` : ''}
</package>`;
}

interface NavSpec {
  label: string;
  href?: string;
  children?: NavSpec[];
}

function navList(items: NavSpec[], indent = '      '): string {
  const li = items.map((i) => {
    const content = i.href !== undefined ? `<a href="${i.href}">${i.label}</a>` : `<span>${i.label}</span>`;
    const nested = i.children?.length ? `\n${indent}  <ol>\n${navList(i.children, `${indent}    `)}\n${indent}  </ol>\n${indent}` : '';
    return `${indent}<li>${content}${nested}</li>`;
  });
  return li.join('\n');
}

function navDoc(items: NavSpec[], landmarks?: Array<{ type: string; href: string; label: string }>): string {
  const lm = landmarks
    ? `\n  <nav epub:type="landmarks">\n    <ol>\n${landmarks
        .map((l) => `      <li><a epub:type="${l.type}" href="${l.href}">${l.label}</a></li>`)
        .join('\n')}\n    </ol>\n  </nav>`
    : '';
  const ol = items.length ? `<ol>\n${navList(items)}\n    </ol>` : '<ol></ol>';
  return xhtml('Contents', `  <nav epub:type="toc" id="toc">\n    <h1>Contents</h1>\n    ${ol}\n  </nav>${lm}`);
}

function ncxDoc(title: string, points: Array<{ label: string; src: string }>): string {
  const nav = points
    .map(
      (p, i) =>
        `    <navPoint id="navpoint${i + 1}" playOrder="${i + 1}">\n      <navLabel><text>${p.label}</text></navLabel>\n      <content src="${p.src}"/>\n    </navPoint>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <head><meta name="dtb:uid" content="fixture"/></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${nav}
  </navMap>
</ncx>`;
}

const XHTML = 'application/xhtml+xml';
const PNG = 'image/png';
const NCX = 'application/x-dtbncx+xml';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** One expected TOC entry, flattened depth-first. `href: null` = unresolved (greyed). */
export interface ExpectedTocEntry {
  label: string;
  href: string | null;
}

export interface EpubFixture {
  /** File stem under verification/fixtures/malformed/. */
  name: string;
  title: string;
  /** Taxonomy rows (plan §2) this fixture exercises. */
  covers: string[];
  opfPath: string;
  /** Archive entries (zip path → contents), excluding mimetype + container. */
  files: Record<string, string | Uint8Array>;
  expected: {
    tocSource: 'nav' | 'ncx';
    toc: ExpectedTocEntry[];
    /** Chapter titles the import's offscreen pass would derive (spine href → title). */
    chapterTitles?: Record<string, string>;
    /** OPF-relative href of the cover image the resolver must pick (null = none). */
    cover: string | null;
  };
}

const COVER_ART = () => makePng(300, 450, 150);
const LOGO = () => makePng(400, 100, 90);
const ICON = () => makePng(32, 32, 60);
const LANDSCAPE_PLATE = () => makePng(500, 400, 110);

/**
 * T1 + T7 + C1 — the shape of the user report that started this work
 * (InDesign → Sigil export): nav doc in `Text/` with `../Text/` hrefs, an NCX
 * whose every label is a `*FIX_` placeholder, no cover markers at all, the
 * cover only as an `<img>` in `Text/cover.xhtml`, and decoy logo/icon images.
 */
const navSubfolderUndeclaredCover: EpubFixture = {
  name: 'nav-subfolder-undeclared-cover',
  title: 'Nav In Subfolder',
  covers: ['T1', 'T3', 'T7', 'C1', 'C7'],
  opfPath: 'OEBPS/content.opf',
  files: {
    'OEBPS/content.opf': opf({
      title: 'Nav In Subfolder',
      tocId: 'ncx',
      manifest: [
        { id: 'CH1_Opener.xhtml', href: 'Text/CH1_Opener.xhtml', type: XHTML },
        { id: 'ncx', href: 'toc.ncx', type: NCX },
        { id: 'toc', href: 'Text/toc.xhtml', type: XHTML, properties: 'nav' },
        { id: 'logo.png', href: 'Images/Publisher_Logo.png', type: PNG },
        { id: 'icon.png', href: 'Images/facebook.png', type: PNG },
        { id: 'CH1.xhtml', href: 'Text/CH1.xhtml', type: XHTML },
        { id: 'Ch2.xhtml', href: 'Text/Ch2.xhtml', type: XHTML },
        { id: 'cover.xhtml', href: 'Text/cover.xhtml', type: XHTML },
        { id: 'art.png', href: 'Images/img-0001.png', type: PNG },
        { id: 'title.xhtml', href: 'Text/title.xhtml', type: XHTML },
        { id: 'info.xhtml', href: 'Text/info.xhtml', type: XHTML },
      ],
      spine: ['cover.xhtml', 'info.xhtml', 'title.xhtml', 'CH1_Opener.xhtml', 'CH1.xhtml', 'Ch2.xhtml'],
    }),
    'OEBPS/toc.ncx': ncxDoc('Nav In Subfolder', [
      { label: '*FIX_Nav In Subfolder.543173.int', src: 'Text/cover.xhtml' },
      { label: '*FIX_Nav In Subfolder.543173.int', src: 'Text/CH1_Opener.xhtml' },
      { label: '*FIX_Nav In Subfolder.543173.int', src: 'Text/CH1.xhtml' },
      { label: '*FIX_Nav In Subfolder.543173.int', src: 'Text/Ch2.xhtml' },
    ]),
    'OEBPS/Text/toc.xhtml': navDoc([
      { label: 'Cover', href: '../Text/cover.xhtml' },
      { label: 'Newsletter Signup', href: '../Text/info.xhtml' },
      { label: 'Chapter 1 Epigraph', href: '../Text/CH1_Opener.xhtml' },
      { label: 'Chapter 1 Why I Wrote This Book', href: '../Text/CH1.xhtml' },
      // T3: the nav says CH2, the file is Ch2.
      { label: 'Chapter 2 What Is the Difference', href: '../Text/CH2.xhtml' },
    ]),
    'OEBPS/Text/cover.xhtml': xhtml(
      'Cover',
      '<section id="cover" epub:type="cover"><img alt="cover image" id="coverimage" src="../Images/img-0001.png"/></section>',
    ),
    'OEBPS/Text/info.xhtml': xhtml(
      'Info',
      '<p>Sign up for our newsletter.</p><p><img src="../Images/facebook.png" alt="facebook"/></p>',
    ),
    'OEBPS/Text/title.xhtml': xhtml('Title', '<h1>Nav In Subfolder</h1><p><img src="../Images/Publisher_Logo.png" alt="logo"/></p>'),
    'OEBPS/Text/CH1_Opener.xhtml': xhtml('Epigraph', '<blockquote><p>An opening quotation for the first chapter.</p></blockquote>'),
    'OEBPS/Text/CH1.xhtml': chapter('Why I Wrote This Book', 1),
    'OEBPS/Text/Ch2.xhtml': chapter('What Is the Difference', 2),
    'OEBPS/Images/img-0001.png': COVER_ART(),
    'OEBPS/Images/Publisher_Logo.png': LOGO(),
    'OEBPS/Images/facebook.png': ICON(),
  },
  expected: {
    tocSource: 'nav',
    toc: [
      { label: 'Cover', href: 'Text/cover.xhtml' },
      { label: 'Newsletter Signup', href: 'Text/info.xhtml' },
      { label: 'Chapter 1 Epigraph', href: 'Text/CH1_Opener.xhtml' },
      { label: 'Chapter 1 Why I Wrote This Book', href: 'Text/CH1.xhtml' },
      { label: 'Chapter 2 What Is the Difference', href: 'Text/Ch2.xhtml' },
    ],
    cover: 'Images/img-0001.png',
  },
};

/**
 * T2 + T4 + C6 — every way an href can be spelled differently from the
 * manifest: percent-encoding in either direction, `./`, a zip-root path with
 * the OPF folder, backslashes; plus a cover whose manifest href is encoded
 * while the zip entry name is not.
 */
const hrefVariants: EpubFixture = {
  name: 'href-variants',
  title: 'Href Variants',
  covers: ['T2', 'T3', 'T4', 'C6'],
  opfPath: 'OEBPS/content.opf',
  files: {
    'OEBPS/content.opf': opf({
      title: 'Href Variants',
      manifest: [
        { id: 'nav', href: 'nav.xhtml', type: XHTML, properties: 'nav' },
        { id: 'c1', href: 'Text/Chapter%20One.xhtml', type: XHTML },
        { id: 'c2', href: "Text/don%27t-panic.xhtml", type: XHTML },
        { id: 'c3', href: 'Text/Ch3.xhtml', type: XHTML },
        { id: 'c4', href: 'Text/ch4.xhtml', type: XHTML },
        { id: 'c5', href: 'Text/ch5.xhtml', type: XHTML },
        { id: 'c6', href: 'Text/ch6.xhtml', type: XHTML },
        { id: 'cover-img', href: 'Images/cover%20art.png', type: PNG, properties: 'cover-image' },
      ],
      spine: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
    }),
    'OEBPS/nav.xhtml': navDoc([
      { label: 'One (decoded href)', href: 'Text/Chapter One.xhtml' },
      { label: "Don't Panic (decoded, with fragment)", href: "Text/don't-panic.xhtml#start" },
      { label: 'Three (wrong case)', href: 'Text/CH3.xhtml' },
      { label: 'Four (dot slash)', href: './Text/ch4.xhtml' },
      { label: 'Five (zip-root path)', href: '/OEBPS/Text/ch5.xhtml' },
      { label: 'Six (backslashes)', href: 'OEBPS\\Text\\ch6.xhtml' },
    ]),
    'OEBPS/Text/Chapter One.xhtml': chapter('One', 1),
    "OEBPS/Text/don't-panic.xhtml": chapter("Don't Panic", 2, '<p id="start">The start anchor.</p>\n'),
    'OEBPS/Text/Ch3.xhtml': chapter('Three', 3),
    'OEBPS/Text/ch4.xhtml': chapter('Four', 4),
    'OEBPS/Text/ch5.xhtml': chapter('Five', 5),
    'OEBPS/Text/ch6.xhtml': chapter('Six', 6),
    'OEBPS/Images/cover art.png': COVER_ART(),
  },
  expected: {
    tocSource: 'nav',
    toc: [
      { label: 'One (decoded href)', href: 'Text/Chapter%20One.xhtml' },
      { label: "Don't Panic (decoded, with fragment)", href: 'Text/don%27t-panic.xhtml#start' },
      { label: 'Three (wrong case)', href: 'Text/Ch3.xhtml' },
      { label: 'Four (dot slash)', href: 'Text/ch4.xhtml' },
      { label: 'Five (zip-root path)', href: 'Text/ch5.xhtml' },
      { label: 'Six (backslashes)', href: 'Text/ch6.xhtml' },
    ],
    cover: 'Images/cover%20art.png',
  },
};

/**
 * T5 + T6 + T7 (bare ordinals) + T9 + C5 — TOC structure defects: a `<span>`
 * group heading, a fragment-only child, links to a manifest item outside the
 * spine and to a file that does not exist, and "Chapter N" labels that the
 * NCX (or the chapter headings) can name better. The cover-image property
 * wrongly points at an XHTML page.
 */
const tocStructureEdgeCases: EpubFixture = {
  name: 'toc-structure-edge-cases',
  title: 'Toc Edge Cases',
  covers: ['T5', 'T6', 'T7', 'T9', 'C5'],
  opfPath: 'OEBPS/content.opf',
  files: {
    'OEBPS/content.opf': opf({
      title: 'Toc Edge Cases',
      tocId: 'ncx',
      manifest: [
        { id: 'nav', href: 'Text/nav.xhtml', type: XHTML, properties: 'nav' },
        { id: 'ncx', href: 'toc.ncx', type: NCX },
        { id: 'coverpage', href: 'Text/coverpage.xhtml', type: XHTML, properties: 'cover-image' },
        { id: 'plate', href: 'Images/plate.png', type: PNG },
        { id: 'ch1', href: 'Text/ch1.xhtml', type: XHTML },
        { id: 'ch2', href: 'Text/ch2.xhtml', type: XHTML },
        { id: 'ch3', href: 'Text/ch3.xhtml', type: XHTML },
        { id: 'ch4', href: 'Text/ch4.xhtml', type: XHTML },
        { id: 'extra', href: 'Text/extra.xhtml', type: XHTML },
      ],
      spine: ['coverpage', 'ch1', 'ch2', 'ch3', 'ch4'],
    }),
    'OEBPS/toc.ncx': ncxDoc('Toc Edge Cases', [
      { label: 'The Beginning', src: 'Text/ch1.xhtml' },
      { label: 'The Middle', src: 'Text/ch2.xhtml' },
      { label: 'Chapter 3', src: 'Text/ch3.xhtml' },
      { label: 'Epilogue', src: 'Text/ch4.xhtml' },
    ]),
    'OEBPS/Text/nav.xhtml': navDoc([
      {
        label: 'Part One',
        children: [
          { label: 'Chapter 1', href: 'ch1.xhtml' },
          { label: 'Chapter 2', href: 'ch2.xhtml', children: [{ label: 'A Subsection', href: '#sec2' }] },
        ],
      },
      { label: 'Chapter 3', href: 'ch3.xhtml' },
      { label: 'Appendix (not in spine)', href: 'extra.xhtml' },
      { label: 'Missing Chapter', href: 'missing.xhtml' },
      { label: 'Epilogue', href: 'ch4.xhtml' },
    ]),
    'OEBPS/Text/coverpage.xhtml': xhtml('Cover', '<div><img src="../Images/plate.png" alt="cover"/></div>'),
    'OEBPS/Text/ch1.xhtml': chapter('The Beginning', 1),
    'OEBPS/Text/ch2.xhtml': chapter('The Middle', 2, '<h2 id="sec2">A Subsection</h2>\n'),
    'OEBPS/Text/ch3.xhtml': chapter('The Long Road', 3),
    'OEBPS/Text/ch4.xhtml': chapter('Epilogue', 4),
    'OEBPS/Text/extra.xhtml': chapter('Appendix', 5),
    'OEBPS/Images/plate.png': COVER_ART(),
  },
  expected: {
    tocSource: 'nav',
    chapterTitles: { 'Text/ch3.xhtml': 'The Long Road' },
    toc: [
      { label: 'Part One', href: 'Text/ch1.xhtml' },
      { label: 'The Beginning', href: 'Text/ch1.xhtml' },
      { label: 'The Middle', href: 'Text/ch2.xhtml' },
      { label: 'A Subsection', href: 'Text/ch2.xhtml#sec2' },
      { label: 'The Long Road', href: 'Text/ch3.xhtml' },
      { label: 'Appendix (not in spine)', href: null },
      { label: 'Missing Chapter', href: null },
      { label: 'Epilogue', href: 'Text/ch4.xhtml' },
    ],
    cover: 'Images/plate.png',
  },
};

/**
 * T8 + C2 + C3 — the nav document exists but its TOC list is empty, while
 * the NCX is fine; the cover is declared only in `<guide>`, and the cover
 * page draws it with SVG `<image xlink:href>`.
 */
const navEmptyNcxGood: EpubFixture = {
  name: 'nav-empty-ncx-good',
  title: 'Empty Nav',
  covers: ['T8', 'C2', 'C3'],
  opfPath: 'content.opf',
  files: {
    'content.opf': opf({
      title: 'Empty Nav',
      tocId: 'ncx',
      manifest: [
        { id: 'nav', href: 'nav.xhtml', type: XHTML, properties: 'nav' },
        { id: 'ncx', href: 'toc.ncx', type: NCX },
        { id: 'titlepage', href: 'titlepage.xhtml', type: XHTML },
        { id: 'pic', href: 'images/artwork.png', type: PNG },
        { id: 'a', href: 'text/a.xhtml', type: XHTML },
        { id: 'b', href: 'text/b.xhtml', type: XHTML },
      ],
      spine: ['titlepage', 'a', 'b'],
      guide: '<reference type="cover" title="Cover" href="titlepage.xhtml"/>',
    }),
    'nav.xhtml': navDoc([]),
    'toc.ncx': ncxDoc('Empty Nav', [
      { label: 'Opening Moves', src: 'text/a.xhtml' },
      { label: 'Closing Moves', src: 'text/b.xhtml' },
    ]),
    'titlepage.xhtml': xhtml(
      'Cover',
      '<div><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="100%" height="100%" viewBox="0 0 300 450" preserveAspectRatio="none"><image width="300" height="450" xlink:href="images/artwork.png"/></svg></div>',
    ),
    'text/a.xhtml': chapter('Opening Moves', 1),
    'text/b.xhtml': chapter('Closing Moves', 2),
    'images/artwork.png': COVER_ART(),
  },
  expected: {
    tocSource: 'ncx',
    toc: [
      { label: 'Opening Moves', href: 'text/a.xhtml' },
      { label: 'Closing Moves', href: 'text/b.xhtml' },
    ],
    cover: 'images/artwork.png',
  },
};

/**
 * C4 + C7 + C8 (EPUB 2, NCX only, NCX in a subfolder — T1 for NCX): the
 * cover meta names a file by href instead of a manifest id, and that file is
 * corrupt; the first page holds only a publisher logo; the real cover is an
 * image merely NAMED like one.
 */
const coverMetaHrefCorrupt: EpubFixture = {
  name: 'cover-meta-href-corrupt',
  title: 'Meta Href Cover',
  covers: ['T1', 'C4', 'C7', 'C8'],
  opfPath: 'OEBPS/content.opf',
  files: {
    'OEBPS/content.opf': opf({
      version: '2.0',
      title: 'Meta Href Cover',
      tocId: 'ncx',
      meta: '<meta name="cover" content="Images/broken.jpg"/>',
      manifest: [
        { id: 'ncx', href: 'nav/toc.ncx', type: NCX },
        { id: 'broken', href: 'Images/broken.jpg', type: 'image/jpeg' },
        { id: 'logo', href: 'Images/logo.png', type: PNG },
        { id: 'front', href: 'Images/front.png', type: PNG },
        { id: 'title', href: 'Text/title.xhtml', type: XHTML },
        { id: 'one', href: 'Text/one.xhtml', type: XHTML },
        { id: 'two', href: 'Text/two.xhtml', type: XHTML },
      ],
      spine: ['title', 'one', 'two'],
    }),
    'OEBPS/nav/toc.ncx': ncxDoc('Meta Href Cover', [
      { label: 'Title Page', src: '../Text/title.xhtml' },
      { label: 'First Light', src: '../Text/one.xhtml' },
      { label: 'Second Wind', src: '../Text/two.xhtml' },
    ]),
    'OEBPS/Text/title.xhtml': xhtml('Title', '<h1>Meta Href Cover</h1><p><img src="../Images/logo.png" alt="logo"/></p>'),
    'OEBPS/Text/one.xhtml': chapter('First Light', 1),
    'OEBPS/Text/two.xhtml': chapter('Second Wind', 2),
    'OEBPS/Images/broken.jpg': CORRUPT_JPEG,
    'OEBPS/Images/logo.png': LOGO(),
    'OEBPS/Images/front.png': COVER_ART(),
  },
  expected: {
    tocSource: 'ncx',
    toc: [
      { label: 'Title Page', href: 'Text/title.xhtml' },
      { label: 'First Light', href: 'Text/one.xhtml' },
      { label: 'Second Wind', href: 'Text/two.xhtml' },
    ],
    cover: 'Images/front.png',
  },
};

/**
 * C3 (landmarks) — the cover is declared only by an EPUB 3 landmarks entry
 * (relative to a nav in a subfolder) pointing at a page that is NOT first in
 * the spine; the first page holds a landscape plate that must lose.
 */
const coverLandmarks: EpubFixture = {
  name: 'cover-landmarks',
  title: 'Landmark Cover',
  covers: ['T1', 'C3'],
  opfPath: 'OPS/package.opf',
  files: {
    'OPS/package.opf': opf({
      title: 'Landmark Cover',
      manifest: [
        { id: 'nav', href: 'xhtml/nav.xhtml', type: XHTML, properties: 'nav' },
        { id: 'frontis', href: 'xhtml/frontis.xhtml', type: XHTML },
        { id: 'jacket', href: 'xhtml/jacket.xhtml', type: XHTML },
        { id: 'p1', href: 'xhtml/part1.xhtml', type: XHTML },
        { id: 'plate', href: 'img/p000.png', type: PNG },
        { id: 'art', href: 'img/p001.png', type: PNG },
      ],
      spine: ['frontis', 'jacket', 'p1'],
    }),
    'OPS/xhtml/nav.xhtml': navDoc(
      [
        { label: 'Frontispiece', href: 'frontis.xhtml' },
        { label: 'Part One: Arrival', href: 'part1.xhtml' },
      ],
      [{ type: 'cover', href: 'jacket.xhtml', label: 'Cover' }],
    ),
    'OPS/xhtml/frontis.xhtml': xhtml('Frontispiece', '<p><img src="../img/p000.png" alt="plate"/></p>'),
    'OPS/xhtml/jacket.xhtml': xhtml('Jacket', '<p><img src="../img/p001.png" alt=""/></p>'),
    'OPS/xhtml/part1.xhtml': chapter('Part One: Arrival', 1),
    'OPS/img/p000.png': LANDSCAPE_PLATE(),
    'OPS/img/p001.png': COVER_ART(),
  },
  expected: {
    tocSource: 'nav',
    toc: [
      { label: 'Frontispiece', href: 'xhtml/frontis.xhtml' },
      { label: 'Part One: Arrival', href: 'xhtml/part1.xhtml' },
    ],
    cover: 'img/p001.png',
  },
};

export const MALFORMED_EPUB_FIXTURES: readonly EpubFixture[] = [
  navSubfolderUndeclaredCover,
  hrefVariants,
  tocStructureEdgeCases,
  navEmptyNcxGood,
  coverMetaHrefCorrupt,
  coverLandmarks,
];

function decodeOrSelf(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The fixture's files as an `ArchivePort` (structural — see
 * `@lib/epub/structure/bookStructure`), without zipping. Like real zip
 * readers it accepts both the as-written and the percent-decoded path.
 * `reads` records every path requested, for read-budget assertions.
 */
export function fixtureArchive(fixture: EpubFixture): {
  readText(zipPath: string): Promise<string | undefined>;
  readBlob(zipPath: string, mediaType: string): Promise<Blob | undefined>;
  reads: string[];
} {
  const lookup = (zipPath: string) => fixture.files[zipPath] ?? fixture.files[decodeOrSelf(zipPath)];
  const reads: string[] = [];
  return {
    reads,
    async readText(zipPath) {
      reads.push(zipPath);
      const data = lookup(zipPath);
      return typeof data === 'string' ? data : data ? new TextDecoder().decode(data) : undefined;
    },
    async readBlob(zipPath, mediaType) {
      reads.push(zipPath);
      const data = lookup(zipPath);
      return data === undefined ? undefined : new Blob([data as BlobPart], { type: mediaType });
    },
  };
}

/** Flatten a TOC tree depth-first into the `ExpectedTocEntry` shape. */
export function flattenToc(
  items: Array<{ label: string; href: string; unresolved?: boolean; subitems?: unknown[] }>,
): ExpectedTocEntry[] {
  const out: ExpectedTocEntry[] = [];
  const visit = (list: typeof items) => {
    for (const item of list) {
      out.push({ label: item.label, href: item.unresolved ? null : item.href });
      if (item.subitems) visit(item.subitems as typeof items);
    }
  };
  visit(items);
  return out;
}

const FIXED_DATE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

/** Build a fixture's `.epub` bytes (deterministic). */
export async function buildFixtureEpub(fixture: EpubFixture): Promise<Uint8Array> {
  const zip = new JSZip();
  const opts = { date: FIXED_DATE, createFolders: false } as const;
  zip.file('mimetype', 'application/epub+zip', { ...opts, compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${fixture.opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    opts,
  );
  for (const [path, data] of Object.entries(fixture.files)) zip.file(path, data, opts);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', platform: 'DOS' });
}
