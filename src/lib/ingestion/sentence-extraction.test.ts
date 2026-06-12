import { describe, it, expect } from 'vitest';
import { extractSentencesFromNode, TTS_EXTRACTION_VERSION } from './sentence-extraction';
import { TextSegmenter, DEFAULT_SENTENCE_STARTERS } from '@lib/tts/TextSegmenter';
import type { CacheTtsPreparation } from '~types/db';

describe('extractSentencesFromNode', () => {
  const mockCfiGenerator = (range: Range) => `cfi(${range.startOffset})`;

  it('should return empty array if no text content', () => {
    const div = document.createElement('div');
    const { sentences: result } = extractSentencesFromNode(div, mockCfiGenerator);
    expect(result).toEqual([]);
  });

  it('should extract sentences from text nodes', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>Hello world. This is a test.</p>';
    const { sentences: result } = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Hello world.');
    expect(result[1].text).toBe('This is a test.');
  });

  it('should handle text without punctuation as a sentence', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>No punctuation</p>';
    const { sentences: result } = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('No punctuation');
  });

  it('should treat newlines in block tags as spaces', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>First part\nSecond part.</p>';
    const { sentences: result } = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('First part Second part.');
  });

  it('should treat <br> as sentence break', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>First line<br>Second line.</p>';
    const { sentences: result } = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('First line');
    expect(result[1].text).toBe('Second line.');
  });

  it('should preserve newlines in <pre> tags', () => {
    const div = document.createElement('div');
    div.innerHTML = '<pre>Line 1\nLine 2</pre>';
    const { sentences: result } = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Line 1');
    expect(result[1].text).toBe('Line 2');
  });

  it('should preserve newlines in nested <pre> tags', () => {
    const div = document.createElement('div');
    div.innerHTML = '<pre><code>Line 1\nLine 2</code></pre>';
    const { sentences: result } = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Line 1');
    expect(result[1].text).toBe('Line 2');
  });

  it('should skip superscript numerical citations', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>This is a sentence.<sup>1</sup> This is another.<sup><a href="#fn1">2</a></sup></p>';
    const { sentences: result } = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('This is a sentence.');
    expect(result[1].text).toBe('This is another.');
  });

  it('should skip anchor tags that look like citations', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>Some text with a citation <a href="#note">[3]</a> and another <a href="#note2">*</a>.</p>';
    const { sentences: result } = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Some text with a citation and another.');
  });

  it('should skip anchors linking to external endnote files (chapter 2 pattern)', () => {
    const div = document.createElement('div');
    // Chapter 2 pattern: <a href="Notes.xhtml#EndnoteN"><span class="_Endnote-Reference">N</span></a>
    // The <a> handler catches this via /notes/i href match
    div.innerHTML = '<p>They propel the platform.<span class="_Endnote-Reference"><a class="anchor" id="ref1"></a></span><a href="Notes.xhtml#Endnote41"><span class="_Endnote-Reference">8</span></a><span class="_Endnote-Reference"></span> More text follows.</p>';
    const { sentences: result } = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('They propel the platform.');
    expect(result[1].text).toBe('More text follows.');
  });

  it('should skip doc-noteref anchors with external hrefs (chapter 3 pattern)', () => {
    const div = document.createElement('div');
    // Chapter 3 pattern: <sup><a href="16_notes.xhtml#chapter3-17" role="doc-noteref">17</a></sup>
    div.innerHTML = '<p>Focused on the top 1 percent in orbit.<sup><a href="16_notes.xhtml#chapter3-17" id="ch3_17" role="doc-noteref">17</a></sup> More realistically however.</p>';
    const { sentences: result } = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Focused on the top 1 percent in orbit.');
    expect(result[1].text).toBe('More realistically however.');
  });

  it('should skip consecutive citations at end of sentence', () => {
    const div = document.createElement('div');
    // Common pattern: two citations back to back
    div.innerHTML = '<p>A statement with two refs.<sup><a href="#fn1">49</a></sup><sup><a href="#fn2">50</a></sup> Next sentence.</p>';
    const { sentences: result } = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('A statement with two refs.');
    expect(result[1].text).toBe('Next sentence.');
  });

  it('should not skip legitimate anchor tags', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>Click <a href="https://example.com">here</a> for more.</p>';
    const { sentences: result } = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Click here for more.');
  });
});

describe('citation marker leading flag', () => {
  // Any non-empty CFI string marks the citation as captured (so the marker object is built).
  const cfiGen = (range: Range) => `cfi(${range.startOffset})`;

  const markersFrom = (html: string) => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.innerHTML = html;
    const { citationMarkers } = extractSentencesFromNode(div, cfiGen);
    document.body.removeChild(div);
    return citationMarkers;
  };

  it('flags a footnote entry that opens with its reference anchor as leading', () => {
    // <span> isn't a computed superscript in jsdom, so the inner <a href="#..."> is the marker.
    const markers = markersFrom(
      '<div class="footnote"><p><span class="ref"><a href="#fnref_1">1</a></span> Note body text here.</p></div>'
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].leading).toBe(true);
  });

  it('does not flag an in-text citation that follows prose', () => {
    const markers = markersFrom(
      '<p>Some running prose here.<sup><a href="#fn_1">1</a></sup> And it continues.</p>'
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].leading).toBe(false);
  });

  it('does not flag a trailing citation at the end of a paragraph', () => {
    const markers = markersFrom(
      '<p>A sentence that ends with a note.<sup><a href="#fn_2">2</a></sup></p>'
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].leading).toBe(false);
  });

  it('treats leading whitespace before the marker as still leading', () => {
    const markers = markersFrom(
      '<div class="endnote"><p>\n   <sup><a href="#en_1">1</a></sup> Endnote prose.</p></div>'
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].leading).toBe(true);
  });

  it('does not flag a marker preceded by a non-whitespace inline element', () => {
    const markers = markersFrom(
      '<p><span class="label">Note</span><sup><a href="#fn_3">3</a></sup> body.</p>'
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].leading).toBe(false);
  });
});

describe('regression: NFKD normalization corrupted sentence CFI ranges for non-ASCII text', () => {
  // Segmentation offsets used to be computed against NFKD-normalized text and then
  // mapped onto the raw (un-normalized) DOM text nodes: every decomposable character
  // (NFC é, ligature ﬁ, …) before a sentence start shifted the Range — and therefore
  // the persisted CFI — to the right by the cumulative length drift. Ranges must
  // cover the exact raw characters; only the outbound sentence text is normalized.
  const extractWithRanges = (html: string) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    const ranges: string[] = [];
    const cfiGenerator = (range: Range) => {
      ranges.push(range.toString());
      return `cfi(${ranges.length})`;
    };
    const { sentences } = extractSentencesFromNode(div, cfiGenerator);
    return { sentences, ranges };
  };

  it('ranges cover the exact raw characters when precomposed accents precede a sentence', () => {
    const { sentences, ranges } = extractWithRanges('<p>Le café est bon. Voilà le chat. Fin.</p>');

    // Pre-fix, "café"/"Voilà" each lengthened under NFKD, so the second and third
    // ranges started 1 and 2 characters too far right.
    expect(ranges).toEqual(['Le café est bon. ', 'Voilà le chat. ', 'Fin.']);
    expect(sentences).toHaveLength(3);
    expect(sentences[2].text).toBe('Fin.');
  });

  it('ranges cover the exact raw characters with combining-mark accents (e + U+0301)', () => {
    const { sentences, ranges } = extractWithRanges('<p>Le cafe\u0301 est bon. Fin.</p>');

    expect(ranges).toEqual(['Le cafe\u0301 est bon. ', 'Fin.']);
    expect(sentences).toHaveLength(2);
    expect(sentences[1].text).toBe('Fin.');
  });

  it('ranges stay correct when the accented text spans multiple text nodes', () => {
    // Pre-fix, the drifted end offset overran the last text node and the final
    // sentence was silently dropped (no CFI could be generated).
    const { sentences, ranges } = extractWithRanges('<p>Le caf<em>é</em> est bon. Fin.</p>');

    expect(ranges).toEqual(['Le café est bon. ', 'Fin.']);
    expect(sentences).toHaveLength(2);
    expect(sentences[1].text).toBe('Fin.');
  });

  it('ranges cover the exact raw characters across ligatures (ﬁ)', () => {
    const { sentences, ranges } = extractWithRanges('<p>The ﬁrst rule. The second rule.</p>');

    expect(ranges).toEqual(['The ﬁrst rule. ', 'The second rule.']);
    expect(sentences).toHaveLength(2);
    // Outbound sentence text is still NFKD-normalized: the ligature decomposes.
    expect(sentences[0].text).toBe('The first rule.');
    expect(sentences[1].text).toBe('The second rule.');
  });

  it('ranges cover the exact raw characters for CJK text', () => {
    const { sentences, ranges } = extractWithRanges('<p>你好。世界！这是一个测试？</p>');

    expect(ranges).toEqual(['你好。', '世界！', '这是一个测试？']);
    // Outbound text is NFKD-normalized (fullwidth punctuation decomposes to ASCII).
    expect(sentences.map(s => s.text)).toEqual(
      ['你好。', '世界！', '这是一个测试？'].map(t => t.normalize('NFKD'))
    );
  });
});

describe('extraction v3 — raw at rest (5c-PR4; phase5-tts-strangler.md §5c.1)', () => {
  // The version constant bumps ONLY with this comparison suite green: on the
  // composed-accent / ligature / CJK fixtures (the 4197cdab NFKD regression
  // family above), the v3 output must carry CFIs IDENTICAL to what the v2
  // pipeline persisted (v2 = raw extraction + an ingest-time refineSegments
  // pass with empty abbreviations). Refinement is a no-op on these fixtures,
  // so any drift here would be a real CFI regression from the format change.
  const extractBoth = (html: string) => {
    const run = () => {
      const div = document.createElement('div');
      div.innerHTML = html;
      let n = 0;
      const cfiGenerator = (range: Range) => `cfi(${range.toString()}|${++n})`;
      return extractSentencesFromNode(div, cfiGenerator).sentences;
    };
    const v3 = run();
    // The legacy v2 tail: refine with the import-time inputs the library store
    // passed (empty abbreviations/alwaysMerge, default starters).
    const v2 = TextSegmenter.refineSegments(run(), [], [], DEFAULT_SENTENCE_STARTERS);
    return { v2, v3 };
  };

  it('pins the version constant (rows written from here on are unrefined)', () => {
    expect(TTS_EXTRACTION_VERSION).toBe(3);
  });

  it.each([
    ['composed accents (NFC é)', '<p>Le café est bon. Voilà le chat. Fin.</p>'],
    ['combining marks (e + U+0301)', '<p>Le cafe\u0301 est bon. Fin.</p>'],
    ['ligature (ﬁ)', '<p>The ﬁrst rule. The second rule.</p>'],
    ['CJK', '<p>你好。世界！这是一个测试？</p>'],
  ])('v3 CFIs match the v2 pipeline on %s', (_label, html) => {
    const { v2, v3 } = extractBoth(html);
    expect(v3.map(sn => sn.cfi)).toEqual(v2.map(sn => sn.cfi));
    expect(v3.map(sn => sn.text)).toEqual(v2.map(sn => sn.text));
  });

  it('stores UNREFINED sentences: an abbreviation split is preserved at rest', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>He met Mr. Smith yesterday.</p>';
    let n = 0;
    const { sentences } = extractSentencesFromNode(div, () => `cfi(${++n})`);
    // Intl.Segmenter splits after "Mr." — v2 baked the merge into the row;
    // v3 keeps the raw split (playback refines against CURRENT settings).
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences[0].text.endsWith('Mr.')).toBe(true);
    // Each raw sentence carries its own source index (the skip-mask currency).
    sentences.forEach((sn, i) => expect(sn.sourceIndices).toEqual([i]));
  });

  it('old rows are retained: the read path serves any extractionVersion (graft rule)', () => {
    // No purge/filter exists anywhere on extractionVersion (the background
    // re-ingestion DRIVER is Phase 7 scope). Pin the rule at the type level:
    // the row schema keeps the field optional, so v1 (absent) / v2 / v3 rows
    // all remain valid reads.
    const v1Row = { id: 'b-s', bookId: 'b', sectionId: 's', sentences: [] } as CacheTtsPreparation;
    const v3Row = { ...v1Row, extractionVersion: TTS_EXTRACTION_VERSION } as CacheTtsPreparation;
    expect(v1Row.extractionVersion).toBeUndefined();
    expect(v3Row.extractionVersion).toBe(3);
  });
});
