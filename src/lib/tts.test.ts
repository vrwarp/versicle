import { describe, it, expect } from 'vitest';
import { extractSentences } from './tts';

// Mock useTTSStore
vi.mock('../store/useTTSStore', () => ({
    useTTSStore: {
        getState: vi.fn(() => ({
            customAbbreviations: ['Mr.', 'Mrs.', 'Dr.']
        })),
    }
}));

describe('extractSentences', () => {
  it('should return empty array if no contents', () => {
     const mockRendition = {
      getContents: vi.fn(() => []),
    };
    // @ts-expect-error Mocking
    const result = extractSentences(mockRendition);
    expect(result).toEqual([]);
  });

  it('should extract sentences from text nodes', () => {
    // Create real DOM elements
    const dom = new DOMParser().parseFromString(
        '<p>Hello world. This is a test.</p>',
        'text/html'
    );

    // Mock Rendition
    const mockRendition = {
        getContents: () => [{
            document: dom,
            cfiFromRange: () => 'test-cfi'
        }]
    };

    // @ts-expect-error Mocking
    const result = extractSentences(mockRendition);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Hello world.');
    expect(result[1].text).toBe('This is a test.');
  });

  it('should handle text without punctuation as a sentence', () => {
      const dom = new DOMParser().parseFromString(
        '<p>No punctuation</p>',
        'text/html'
    );
    const mockRendition = {
        getContents: () => [{
            document: dom,
            cfiFromRange: () => 'test-cfi'
        }]
    };

      // @ts-expect-error Mocking
      const result = extractSentences(mockRendition);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('No punctuation');
  });

  it('should treat newlines in block tags as spaces', () => {
    // Newline in <p> should not break sentence
    const dom = new DOMParser().parseFromString(
        '<p>First part\nSecond part.</p>',
        'text/html'
    );

    const mockRendition = {
        getContents: () => [{
            document: dom,
            cfiFromRange: () => 'test-cfi'
        }]
    };

    // @ts-expect-error Mocking
    const result = extractSentences(mockRendition);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('First part Second part.');
  });

  it('should treat <br> as sentence break', () => {
    const dom = new DOMParser().parseFromString(
        '<p>First line<br>Second line.</p>',
        'text/html'
    );

    const mockRendition = {
        getContents: () => [{
            document: dom,
            cfiFromRange: () => 'test-cfi'
        }]
    };

    // @ts-expect-error Mocking
    const result = extractSentences(mockRendition);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('First line');
    expect(result[1].text).toBe('Second line.');
  });

  it('should preserve newlines in <pre> tags', () => {
    const dom = new DOMParser().parseFromString(
        '<pre>Line 1\nLine 2</pre>',
        'text/html'
    );

    const mockRendition = {
        getContents: () => [{
            document: dom,
            cfiFromRange: () => 'test-cfi'
        }]
    };

    // @ts-expect-error Mocking
    const result = extractSentences(mockRendition);

    // In <pre>, newlines should be preserved.
    // Intl.Segmenter typically splits on newlines.
    // So we expect 2 sentences (or 1 with newline if Segmenter allows it, but usually it splits).
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Line 1');
    expect(result[1].text).toBe('Line 2');
  });

  it('should preserve newlines in nested <pre> tags', () => {
    const dom = new DOMParser().parseFromString(
        '<pre><code>Line 1\nLine 2</code></pre>',
        'text/html'
    );

    const mockRendition = {
        getContents: () => [{
            document: dom,
            cfiFromRange: () => 'test-cfi'
        }]
    };

    // @ts-expect-error Mocking
    const result = extractSentences(mockRendition);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Line 1');
    expect(result[1].text).toBe('Line 2');
  });
});
