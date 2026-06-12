const JSZip = require('jszip');
const fs = require('fs');

async function create() {
  const zip = new JSZip();

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.folder('META-INF').file('container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  zip.folder('OEBPS').file('content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Chinese Book</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="pub-id">urn:uuid:test-chinese-1234</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`);

  zip.folder('OEBPS').file('toc.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <title>TOC</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Table of Contents</h1>
      <ol>
        <li><a href="chapter1.xhtml">第一章</a></li>
      </ol>
    </nav>
  </body>
</html>`);

  zip.folder('OEBPS').file('chapter1.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>第一章</title>
  </head>
  <body>
    <h1>第一章</h1>
    <p>这是一本测试用的中文书。你好世界。</p>
  </body>
</html>`);

  const content = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync('verification/test_chinese.epub', content);
  console.log('Created verification/test_chinese.epub');
}

/**
 * P6 entry-gate fixture (prep/phase6-reader-engine.md §Fixture needs): a
 * SECOND book carrying astral-plane Han (U+20000 𠀀, CJK Ext-B — a surrogate
 * pair in UTF-16), an emoji, and mixed BMP lines, for the CH-1 pinyin
 * alignment characterization (test_characterization_pinyin.spec.ts).
 *
 * Deliberately a separate file: test_chinese.epub stays byte-identical so
 * the pre-existing chinese journeys are not invalidated by a fixture rebuild.
 */
async function createAstral() {
  const zip = new JSZip();

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.folder('META-INF').file('container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  zip.folder('OEBPS').file('content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Chinese Astral Book</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="pub-id">urn:uuid:test-chinese-astral-1234</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`);

  zip.folder('OEBPS').file('toc.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <title>TOC</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Table of Contents</h1>
      <ol>
        <li><a href="chapter1.xhtml">第一章</a></li>
      </ol>
    </nav>
  </body>
</html>`);

  // Line 1: astral Han 𠀀 (U+20000) followed by BMP Han — pins the off-by-one
  //         pinyin shift and the trailing-char starvation (CH-1).
  // Line 2: emoji mid-sentence — pins the same starvation after a non-Han
  //         astral char.
  // Line 3: plain BMP control line — alignment must be exact here both
  //         before and after the CH-1 fix.
  zip.folder('OEBPS').file('chapter1.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>第一章</title>
  </head>
  <body>
    <h1>第一章</h1>
    <p>\u{20000}中文好</p>
    <p>考\u{1F600}试通过</p>
    <p>这是普通的中文句子。</p>
  </body>
</html>`);

  const content = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync('verification/test_chinese_astral.epub', content);
  console.log('Created verification/test_chinese_astral.epub');
}

create();
createAstral();
