import { describe, it, expect, vi, beforeEach } from 'vitest';
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
});
