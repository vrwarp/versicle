import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ReaderTTSController } from './ReaderTTSController';
import type { TTSQueueItem } from '../../lib/tts/AudioPlayerService';
import type { Rendition } from 'epubjs';

// Mock epubjs
vi.mock('epubjs', () => {
  return {
    EpubCFI: class {
      cfi: string;
      constructor(cfi?: string | { cfi: string }) {
         if (cfi === undefined) {
             this.cfi = '';
         } else if (typeof cfi === 'string') {
             this.cfi = cfi;
         } else {
             this.cfi = cfi.cfi;
         }
      }
      compare(a: string, b?: string) {
          // If called with two arguments (helper mode)
          if (b !== undefined) {
              if (a < b) return -1;
              if (a > b) return 1;
              return 0;
          }

          // If called with one argument (instance mode)
          // Compare this.cfi with a
          if (this.cfi < a) return -1;
          if (this.cfi > a) return 1;
          return 0;
      }
    }
  };
});

// Mock Store State
const storeState = {
  activeCfi: null as string | null,
  currentIndex: 0,
  status: 'stopped',
  queue: [] as TTSQueueItem[],
  jumpTo: vi.fn(),
};

// Mock Hook
vi.mock('../../store/useTTSStore', () => ({
  useTTSStore: (selector: (state: typeof storeState) => unknown) => selector(storeState)
}));

interface MockRendition {
    display: ReturnType<typeof vi.fn>;
    annotations: {
        add: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
    };
    location: {
        start: { cfi: string };
        end: { cfi: string };
    };
}

describe('ReaderTTSController Performance', () => {
    let mockRendition: MockRendition;

    beforeEach(() => {
        storeState.activeCfi = null;
        storeState.status = 'stopped';
        storeState.currentIndex = 0;
        storeState.queue = [];

        mockRendition = {
            display: vi.fn().mockResolvedValue(undefined),
            annotations: {
                add: vi.fn(),
                remove: vi.fn(),
            },
            location: {
                start: { cfi: '10' },
                end: { cfi: '20' }
            }
        };
        vi.clearAllMocks();
    });

    it('OPTIMIZED BEHAVIOR: does NOT call display if activeCfi is on the current page', () => {
        storeState.status = 'playing';
        storeState.activeCfi = '15'; // '10' < '15' < '20' (Inside current page)

        render(
            <ReaderTTSController
                rendition={mockRendition as unknown as Rendition}
                viewMode="paginated"
                onNext={vi.fn()}
                onPrev={vi.fn()}
            />
        );

        // Should NOT call display because it is already visible
        expect(mockRendition.display).not.toHaveBeenCalled();

        // It should STILL add highlight
        expect(mockRendition.annotations.add).toHaveBeenCalledWith('highlight', '15', {}, expect.any(Function), 'tts-highlight');
    });

    it('calls display if activeCfi is OUTSIDE the current page', () => {
        storeState.status = 'playing';
        storeState.activeCfi = '25'; // '25' > '20' (Outside)

        render(
            <ReaderTTSController
                rendition={mockRendition as unknown as Rendition}
                viewMode="paginated"
                onNext={vi.fn()}
                onPrev={vi.fn()}
            />
        );

        expect(mockRendition.display).toHaveBeenCalledWith('25');
    });
});
