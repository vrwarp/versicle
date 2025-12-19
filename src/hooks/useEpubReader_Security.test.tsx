import React, { useRef } from 'react';
import { render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { useEpubReader, EpubReaderOptions } from './useEpubReader';

// Mock dependencies
vi.mock('../db/DBService', () => ({
  dbService: {
    getBook: vi.fn().mockResolvedValue({ file: new ArrayBuffer(0), metadata: {} }),
    getLocations: vi.fn().mockResolvedValue(null),
    saveLocations: vi.fn().mockResolvedValue(undefined),
    getReadingHistory: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('epubjs', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      renderTo: vi.fn().mockImplementation((element) => {
        const iframe = document.createElement('iframe');
        // Simulate epubjs default sandbox
        iframe.setAttribute('sandbox', 'allow-same-origin');
        element.appendChild(iframe);
        return {
            themes: { register: vi.fn(), select: vi.fn(), fontSize: vi.fn(), font: vi.fn(), default: vi.fn() },
            display: vi.fn(),
            on: vi.fn(),
            hooks: { content: { register: vi.fn() } },
            spread: vi.fn(),
            flow: vi.fn(),
        };
      }),
      loaded: { navigation: Promise.resolve({ toc: [] }) },
      ready: Promise.resolve(),
      destroy: vi.fn(),
      locations: { generate: vi.fn().mockResolvedValue(), save: vi.fn(), load: vi.fn(), percentageFromCfi: vi.fn() },
      spine: { get: vi.fn() }
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

describe('useEpubReader Security', () => {
  it('should NOT add allow-scripts to the iframe sandbox', async () => {
    const { getByTestId } = render(<TestComponent />);

    await waitFor(() => {
        const viewer = getByTestId('viewer');
        const iframe = viewer.querySelector('iframe');
        expect(iframe).not.toBeNull();
    });

    const viewer = getByTestId('viewer');
    const iframe = viewer.querySelector('iframe')!;

    // We expect the sandbox to NOT contain allow-scripts
    // If the vulnerability exists, this expectation will fail (it will contain allow-scripts)
    const sandbox = iframe.getAttribute('sandbox');
    console.log('Sandbox attribute:', sandbox);

    expect(sandbox).not.toContain('allow-scripts');
  });
});
