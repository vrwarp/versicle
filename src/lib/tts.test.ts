import { describe, it, expect } from 'vitest';
import { extractSentencesFromNode } from './tts';

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
