import { describe, it, expect } from 'vitest';
import { extractSentencesFromNode } from './tts';

describe('extractSentencesFromNode', () => {
  const mockCfiGenerator = (range: Range) => `cfi(${range.startOffset})`;

  it('should return empty array if no text content', () => {
    const div = document.createElement('div');
    const result = extractSentencesFromNode(div, mockCfiGenerator);
    expect(result).toEqual([]);
  });

  it('should extract sentences from text nodes', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>Hello world. This is a test.</p>';
    const result = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Hello world.');
    expect(result[1].text).toBe('This is a test.');
  });

  it('should handle text without punctuation as a sentence', () => {
      const div = document.createElement('div');
      div.innerHTML = '<p>No punctuation</p>';
      const result = extractSentencesFromNode(div, mockCfiGenerator);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('No punctuation');
  });

  it('should treat newlines in block tags as spaces', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>First part\nSecond part.</p>';
    const result = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('First part Second part.');
  });

  it('should treat <br> as sentence break', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>First line<br>Second line.</p>';
    const result = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('First line');
    expect(result[1].text).toBe('Second line.');
  });

  it('should preserve newlines in <pre> tags', () => {
    const div = document.createElement('div');
    div.innerHTML = '<pre>Line 1\nLine 2</pre>';
    const result = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Line 1');
    expect(result[1].text).toBe('Line 2');
  });

  it('should preserve newlines in nested <pre> tags', () => {
    const div = document.createElement('div');
    div.innerHTML = '<pre><code>Line 1\nLine 2</code></pre>';
    const result = extractSentencesFromNode(div, mockCfiGenerator);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Line 1');
    expect(result[1].text).toBe('Line 2');
  });
});
