/**
 * Jank-measurement fixture (test_perf_jank.spec.ts): a LARGE Chinese book —
 * three chapters of ~4,500 Han characters each — so the pinyin pipeline's
 * per-character work (readings + per-glyph geometry + overlay spans) runs at
 * a realistic chapter size instead of the two-line test_chinese.epub.
 *
 * Deliberately a separate generator/fixture: test_chinese.epub stays
 * byte-identical (the existing chinese journeys pin against it).
 *
 * Regenerate: node verification/create_perf_chinese_epub.cjs
 */
const JSZip = require('jszip');
const fs = require('fs');

// A bank of distinct sentences (mixed everyday + literary vocabulary) so
// pinyin-pro's segmenter does real work instead of hitting one hot phrase.
const SENTENCES = [
  '这是一本用来测量性能的中文书，里面的文字很多，但内容并不复杂。',
  '清晨的阳光照在窗台上，屋子里安静得只能听见钟表走动的声音。',
  '他沿着河边慢慢地走，心里想着昨天晚上朋友说过的那些话。',
  '图书馆的书架上摆满了各种各样的书籍，有历史、哲学，也有科学与艺术。',
  '火车穿过隧道的时候，车厢里的灯忽然亮了起来，乘客们都抬起了头。',
  '母亲在厨房里准备晚饭，锅里的汤发出咕嘟咕嘟的声音，香味飘满了整个屋子。',
  '孩子们在院子里追逐嬉戏，笑声像铃铛一样清脆，惊起了树上的麻雀。',
  '老人坐在门口的藤椅上，手里拿着一份报纸，眼睛却望着远处的群山。',
  '雨下了整整一夜，第二天早晨，街道被冲洗得干干净净，空气格外清新。',
  '她翻开笔记本，把今天发生的事情一件一件地记录下来，字迹工整而清晰。',
  '银行门口排着长长的队伍，人们耐心地等待着，偶尔低声交谈几句。',
  '音乐会开始之前，乐手们在后台做最后的准备，指挥深深地吸了一口气。',
  '重要的不是走得多快，而是每一步都走得踏实，方向始终清楚。',
  '长江从雪山发源，一路奔流向东，经过高原、峡谷和平原，最后汇入大海。',
];

function chapterBody(index, paragraphs) {
  const parts = [`<h1>第${['一', '二', '三'][index]}章</h1>`];
  for (let p = 0; p < paragraphs; p++) {
    const s1 = SENTENCES[(p * 3 + index) % SENTENCES.length];
    const s2 = SENTENCES[(p * 3 + index + 5) % SENTENCES.length];
    const s3 = SENTENCES[(p * 3 + index + 9) % SENTENCES.length];
    parts.push(`<p>${s1}${s2}${s3}</p>`);
  }
  return parts.join('\n    ');
}

async function create() {
  const zip = new JSZip();

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.folder('META-INF').file('container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  const manifestItems = [];
  const spineItems = [];
  const tocItems = [];
  for (let i = 0; i < 3; i++) {
    const id = `chapter${i + 1}`;
    manifestItems.push(`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${id}"/>`);
    tocItems.push(`<li><a href="${id}.xhtml">第${['一', '二', '三'][i]}章</a></li>`);
    // ~40 paragraphs x ~110 Han chars ≈ 4,500 Han characters per chapter —
    // the upper-middle of real novel chapters, so per-character costs show.
    zip.folder('OEBPS').file(`${id}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>第${['一', '二', '三'][i]}章</title>
  </head>
  <body>
    ${chapterBody(i, 40)}
  </body>
</html>`);
  }

  zip.folder('OEBPS').file('content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Perf Chinese Book</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="pub-id">urn:uuid:perf-chinese-1234</dc:identifier>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
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
        ${tocItems.join('\n        ')}
      </ol>
    </nav>
  </body>
</html>`);

  const content = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync('verification/test_chinese_large.epub', content);
  console.log('Created verification/test_chinese_large.epub');
}

create();
