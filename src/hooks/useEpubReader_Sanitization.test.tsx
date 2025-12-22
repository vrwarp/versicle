import React, { useRef } from 'react';
import { render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import { useEpubReader, EpubReaderOptions } from './useEpubReader';
import * as sanitizer from '../lib/sanitizer';

// Spy on sanitizer
const sanitizeSpy = vi.spyOn(sanitizer, 'sanitizeContent');

// Mock dependencies
vi.mock('../db/DBService', () => ({
  dbService: {
    getBook: vi.fn().mockResolvedValue({ file: new ArrayBuffer(0), metadata: {} }),
    getLocations: vi.fn().mockResolvedValue(null),
    saveLocations: vi.fn().mockResolvedValue(undefined),
    getReadingHistory: vi.fn().mockResolvedValue([]),
  },
}));

const registerSerializeSpy = vi.fn();

vi.mock('epubjs', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      renderTo: vi.fn().mockImplementation((element) => {
          // Create iframe to satisfy the hook logic finding an iframe
          const iframe = document.createElement('iframe');
          element.appendChild(iframe);
          return {
            themes: { register: vi.fn(), select: vi.fn(), fontSize: vi.fn(), font: vi.fn(), default: vi.fn() },
            display: vi.fn(),
            on: vi.fn(),
            hooks: { content: { register: vi.fn() } },
            spread: vi.fn(),
            flow: vi.fn(),
            getContents: vi.fn().mockReturnValue([]),
          };
      }),
      loaded: { navigation: Promise.resolve({ toc: [] }) },
      ready: Promise.resolve(),
      destroy: vi.fn(),
      locations: { generate: vi.fn().mockResolvedValue(), save: vi.fn(), load: vi.fn(), percentageFromCfi: vi.fn() },
      spine: {
          get: vi.fn(),
          hooks: {
              serialize: {
                  register: registerSerializeSpy
              }
          }
      }
    }))
  };
});

const TestComponent = () => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const options: EpubReaderOptions = {
    viewMode: 'paginated',
    currentTheme: 'light',
    customTheme: { bg: '#fff', fg: '#000' },
    fontFamily: 'serif',
    fontSize: 100,
    lineHeight: 1.5,
    shouldForceFont: false,
  };

  useEpubReader('test-book-id', viewerRef, options);

  return <div ref={viewerRef} data-testid="viewer" />;
};

describe('useEpubReader Sanitization', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should register a serialize hook for sanitization', async () => {
    render(<TestComponent />);

    await waitFor(() => {
        expect(registerSerializeSpy).toHaveBeenCalled();
    });
  });

  it('should call sanitizeContent when the hook is executed', async () => {
      // Need to run render to register the spy
      render(<TestComponent />);
      await waitFor(() => {
        expect(registerSerializeSpy).toHaveBeenCalled();
      });

      // Execute the registered hook manually
      const hookFn = registerSerializeSpy.mock.calls[0][0];
      const dirtyHtml = '<script>alert(1)</script><b>Safe</b>';

      // We expect sanitizeContent to be called
      const result = hookFn(dirtyHtml);

      expect(sanitizeSpy).toHaveBeenCalledWith(dirtyHtml);

      // And the return value should be sanitized
      expect(result).toContain('<b>Safe</b>');
      expect(result).not.toContain('<script>');
  });
});
