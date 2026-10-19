import { describe, it, expect } from 'vitest';
import { isPlaceholderTitle, pageLines, parseCopyrightLines } from './copyrightPage';
import { parseMarkup } from './markup';
import { readBookStructure, resolveStructureCopyright, type ArchivePort } from './bookStructure';

const xhtml = (body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>x</title></head>
<body>${body}</body>
</html>`;

const lines = (body: string) => pageLines(parseMarkup(xhtml(body), 'application/xhtml+xml'));

/** The InDesign → Sigil copyright page that motivated the fallback (abridged). */
const CROSSWAY_PAGE = `
  <div>
    <p class="copyright"><span class="i">Reasonable Faith: Christian Truth and Apologetics</span></p>
    <p class="copyright">Copyright © 1984, 1994, 2008 by William Lane Craig</p>
    <p class="copyright">Published by Crossway<br/>1300 Crescent Street<br/>Wheaton, Illinois 60187</p>
    <p class="copyright">Scripture quotations marked esv are from the ESV® Bible, copyright © 2001 by Crossway, a publishing ministry of Good News Publishers.</p>
    <p class="copyright">Library of Congress Cataloging-in-Publication Data</p>
    <p class="copyright">Craig, William Lane.</p>
    <p class="copyright"> Reasonable faith : Christian truth and apologetics / William Lane Craig.—3rd ed.</p>
    <p class="copyright">  p. cm.</p>
    <p class="copyright"> ISBN 978-1-4335-0115-9 (tpb)</p>
  </div>`;

describe('pageLines', () => {
  it('breaks on block elements and <br>, collapsing whitespace', () => {
    expect(lines('<p>One\n  two</p><div>Three<br/>Four</div><span>Five</span>')).toEqual([
      'One two',
      'Three',
      'Four',
      'Five',
    ]);
  });
});

describe('parseCopyrightLines', () => {
  it('reads the CIP block, keeping the page casing of the title', () => {
    expect(parseCopyrightLines(lines(CROSSWAY_PAGE))).toEqual({
      title: 'Reasonable Faith: Christian Truth and Apologetics',
      author: 'William Lane Craig',
    });
  });

  it('falls back to the CIP main entry when the statement names no person', () => {
    expect(
      parseCopyrightLines([
        'Copyright © 2010 Example Press',
        'Library of Congress Cataloging-in-Publication Data',
        'Doe, Jane, 1949-',
        'A book : a subtitle / edited by Somebody Else.',
      ]),
    ).toEqual({ title: 'A book: a subtitle', author: 'Jane Doe' });
  });

  it('takes a personal copyright holder and the line above the notice as title', () => {
    expect(parseCopyrightLines(['The Long Road', 'Copyright © 2015, 2019 by Jane Q. Public. All rights reserved.'])).toEqual({
      title: 'The Long Road',
      author: 'Jane Q. Public',
    });
  });

  it('skips a bare "Copyright" heading when locating the notice', () => {
    expect(parseCopyrightLines(['Copyright', '© 2020 John Smith'])).toEqual({ author: 'John Smith' });
  });

  it('rejects organizations and one-word imprints as authors', () => {
    expect(parseCopyrightLines(['Copyright © 2008 Penguin Random House LLC'])).toEqual({});
    expect(parseCopyrightLines(['© 2008 Crossway'])).toEqual({});
    expect(parseCopyrightLines(['Copyright © 2001 The Estate of John Smith'])).toEqual({});
  });

  it('finds nothing on a page without a copyright notice', () => {
    expect(parseCopyrightLines(['Dedication', 'For my parents'])).toEqual({});
  });
});

describe('isPlaceholderTitle', () => {
  it.each(['', '   ', 'Untitled', 'Reasonable Faith.501159.int', 'Book_Interior_v3', 'chapter01.xhtml', 'Mybook.indd'])(
    'flags %j',
    (t) => expect(isPlaceholderTitle(t)).toBe(true),
  );

  it.each(['Reasonable Faith', 'Mr. Smith Goes to Washington', 'Catch-22', 'The 4-Hour Workweek'])('keeps %j', (t) =>
    expect(isPlaceholderTitle(t)).toBe(false),
  );

  it('flags a missing title', () => expect(isPlaceholderTitle(undefined)).toBe(true));
});

describe('resolveStructureCopyright', () => {
  const OPF = (guide = '') => `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Junk.123456.int</dc:title></metadata>
  <manifest>
    <item id="t" href="title.xhtml" media-type="application/xhtml+xml"/>
    <item id="c" href="copy.xhtml" media-type="application/xhtml+xml"/>
    <item id="b" href="body.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="t"/><itemref idref="b"/><itemref idref="c"/></spine>${guide}
</package>`;

  const archiveOf = (files: Record<string, string>): ArchivePort & { reads: string[] } => {
    const reads: string[] = [];
    return {
      reads,
      readText: async (p) => {
        reads.push(p);
        return files[p];
      },
      readBlob: async () => undefined,
    };
  };

  const files = (guide?: string) => ({
    'OEBPS/content.opf': OPF(guide),
    'OEBPS/title.xhtml': xhtml('<p>The Book</p><p>a novel</p>'),
    'OEBPS/body.xhtml': xhtml('<p>A character says copyright is theft.</p>'),
    'OEBPS/copy.xhtml': xhtml(CROSSWAY_PAGE),
  });

  it('scans front-matter spine documents for the notice', async () => {
    const archive = archiveOf(files());
    const structure = (await readBookStructure(archive, 'OEBPS/content.opf'))!;
    await expect(resolveStructureCopyright(structure, archive)).resolves.toEqual({
      title: 'Reasonable Faith: Christian Truth and Apologetics',
      author: 'William Lane Craig',
    });
  });

  it('reads a declared copyright page first (guide / TOC label)', async () => {
    const archive = archiveOf(files('\n  <guide><reference type="copyright-page" href="copy.xhtml"/></guide>'));
    const structure = (await readBookStructure(archive, 'OEBPS/content.opf'))!;
    archive.reads.length = 0;
    await resolveStructureCopyright(structure, archive);
    expect(archive.reads).toEqual(['OEBPS/copy.xhtml']);

    const viaToc = archiveOf(files());
    const s2 = (await readBookStructure(viaToc, 'OEBPS/content.opf'))!;
    viaToc.reads.length = 0;
    await resolveStructureCopyright(s2, viaToc, [{ id: '1', href: 'copy.xhtml', label: 'Copyright' }]);
    expect(viaToc.reads).toEqual(['OEBPS/copy.xhtml']);
  });

  it('returns nothing when no page carries a notice', async () => {
    const archive = archiveOf({ ...files(), 'OEBPS/copy.xhtml': xhtml('<p>Dedication</p>') });
    const structure = (await readBookStructure(archive, 'OEBPS/content.opf'))!;
    await expect(resolveStructureCopyright(structure, archive)).resolves.toEqual({});
  });
});
