import { describe, it, expect } from 'vitest';
import { parseMarkup } from './markup';
import { parseNavDocument, parseNcxDocument } from './navParser';
import { parsePackageDocument } from './packageModel';

const NAV = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="landmarks"><ol><li><a epub:type="cover" href="cover.xhtml">Cover</a></li></ol></nav>
  <nav epub:type="toc"><ol>
    <li id="p1"><span>Part   One</span><ol>
      <li><a href="a.xhtml">A</a></li>
      <li><a href="a.xhtml">A again</a></li>
    </ol></li>
    <li><a href="b.xhtml#x">B</a></li>
  </ol></nav>
</body></html>`;

describe('parseNavDocument', () => {
  it('parses the toc nav (not landmarks), spans, nesting and parents', () => {
    const { toc, landmarks } = parseNavDocument(parseMarkup(NAV, 'application/xhtml+xml'));
    expect(toc.map((i) => [i.id, i.href, i.label])).toEqual([
      ['p1', '', 'Part One'],
      ['b.xhtml#x', 'b.xhtml#x', 'B'],
    ]);
    expect(toc[0].subitems?.map((i) => [i.href, i.parent])).toEqual([
      ['a.xhtml', 'p1'],
      ['a.xhtml', 'p1'],
    ]);
    // Duplicate href-derived ids are made unique.
    const [first, second] = toc[0].subitems!;
    expect(first.id).not.toBe(second.id);
    expect(landmarks).toEqual([{ type: 'cover', href: 'cover.xhtml' }]);
  });

  it('survives non-well-formed XHTML via the HTML parser fallback', () => {
    const broken = NAV.replace('<li><a href="a.xhtml">A</a></li>', '<li><a href="a.xhtml">A&nbsp;</a><br></li>');
    const { toc } = parseNavDocument(parseMarkup(broken, 'application/xhtml+xml'));
    expect(toc[0].subitems?.[0].href).toBe('a.xhtml');
  });
});

describe('parseNcxDocument', () => {
  it('parses nested navPoints with ids and labels', () => {
    const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
      <navPoint id="n1"><navLabel><text> One </text></navLabel><content src="a.xhtml"/>
        <navPoint id="n2"><navLabel><text>Two</text></navLabel><content src="a.xhtml#2"/></navPoint>
      </navPoint></navMap></ncx>`;
    const toc = parseNcxDocument(parseMarkup(ncx));
    expect(toc).toEqual([
      { id: 'n1', href: 'a.xhtml', label: 'One', subitems: [{ id: 'n2', href: 'a.xhtml#2', label: 'Two', parent: 'n1' }] },
    ]);
  });
});

describe('parsePackageDocument', () => {
  it('reads manifest, spine, nav/ncx, meta cover and guide', () => {
    const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata><meta name="cover" content=" cover-id "/></metadata>
      <manifest>
        <item id="nav" href="Text/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="a" href="Text/a.xhtml" media-type="application/xhtml+xml"/>
        <item id="cover-id" href="i/c.jpg" media-type="IMAGE/JPEG" properties="cover-image"/>
      </manifest>
      <spine toc="ncx"><itemref idref="a"/><itemref idref="ghost"/></spine>
      <guide><reference type="Cover" href="Text/a.xhtml"/></guide>
    </package>`;
    const model = parsePackageDocument(parseMarkup(opf), 'OEBPS/content.opf');
    expect(model).toMatchObject({
      opfDir: 'OEBPS/',
      spine: ['Text/a.xhtml'],
      navPath: 'Text/nav.xhtml',
      ncxPath: 'toc.ncx',
      metaCover: 'cover-id',
      guide: [{ type: 'cover', href: 'Text/a.xhtml' }],
    });
    expect(model.manifest.find((m) => m.id === 'cover-id')).toMatchObject({
      mediaType: 'image/jpeg',
      properties: ['cover-image'],
    });
  });
});
