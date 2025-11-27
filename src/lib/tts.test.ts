import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractSentences } from './tts';

// Mock epubjs Rendition and Contents
const mockCreateRange = vi.fn();
const mockCfiFromRange = vi.fn();

const mockDocument = {
  body: {},
  createTreeWalker: vi.fn(),
  createRange: mockCreateRange,
};

const mockContents = {
  document: mockDocument,
  cfiFromRange: mockCfiFromRange,
};

const mockRendition = {
  getContents: vi.fn(() => [mockContents]),
};

describe('extractSentences', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup basic range mock
    mockCreateRange.mockReturnValue({
        setStart: vi.fn(),
        setEnd: vi.fn(),
    });
  });

  it('should return empty array if no contents', () => {
    mockRendition.getContents.mockReturnValueOnce([]);
    // @ts-expect-error Mocking
    const result = extractSentences(mockRendition);
    expect(result).toEqual([]);
  });

  it('should extract sentences from text nodes', () => {
    // Setup TreeWalker mock
    const textNode = { textContent: 'Hello world. This is a test.' };
    const walkerMock = {
      nextNode: vi.fn()
        .mockReturnValueOnce(textNode)
        .mockReturnValue(null) // End of walk
    };
    mockDocument.createTreeWalker.mockReturnValue(walkerMock);
    mockCfiFromRange.mockReturnValue('epubcfi(/1/2/3:0)');

    // @ts-expect-error Mocking
    const result = extractSentences(mockRendition);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Hello world.');
    expect(result[1].text).toBe('This is a test.');
    expect(mockCfiFromRange).toHaveBeenCalledTimes(2);
  });

  it('should handle text without punctuation as a sentence', () => {
      const textNode = { textContent: 'No punctuation' };
       const walkerMock = {
        nextNode: vi.fn()
          .mockReturnValueOnce(textNode)
          .mockReturnValue(null)
      };
      mockDocument.createTreeWalker.mockReturnValue(walkerMock);
      mockCfiFromRange.mockReturnValue('epubcfi(test)');

      // @ts-expect-error Mocking
      const result = extractSentences(mockRendition);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('No punctuation');
  });
});
