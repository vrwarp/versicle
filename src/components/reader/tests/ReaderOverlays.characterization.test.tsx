/**
 * P6 ENTRY GATE — overlay characterization pins (jsdom fixture tier).
 *
 * Pins the CURRENT behavior of the reader overlay systems named by
 * plan/overhaul/prep/phase6-reader-engine.md §4 / §Test plan BEFORE any
 * engine/manager extraction touches them (program rule 7: characterization
 * before change):
 *
 *   1. user annotation highlights — the ReaderView diff effect
 *      (annotations.add/remove with the color→class mapping, the
 *      audio-bookmark striped class, `__reader_added_annotations_count`)
 *   2. content-analysis debug highlights — debug-analysis-highlight
 *      add/remove keyed on GenAI debug mode + seeded analysis
 *   3. note markers — geometry portal into `rendition.manager.container`
 *      (last-rect placement; current aria contract pinned as-is)
 *
 * The TTS highlight + orphan sweep pins live in the owning
 * ReaderTTSController suite; reading-history highlight pins in
 * useHistoryHighlights.test.ts; pinyin geometry in
 * useEpubReader_Pinyin.characterization.test.tsx.
 *
 * These assertions describe TODAY'S implementation (epub.js annotations
 * called directly from components). The Phase 6 HighlightLayerManager
 * cutover must keep them green — it changes the call path, not the
 * observable epub.js calls. Deliberate characterization deltas (e.g. the
 * ReaderOverlay decorative/interactive contract for note markers) must
 * update the named pin in the same PR and say so in the PR description.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { ReaderView } from '../ReaderView';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useAnnotationStore } from '@store/useAnnotationStore';
import { useContentAnalysisStore } from '@store/useContentAnalysisStore';
import { useGenAIStore } from '@store/useGenAIStore';
import { TYPE_COLORS } from '~types/content-analysis';
import type { UserAnnotation } from '~types/db';
import ePub from 'epubjs';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CURRENT_BOOK_VERSION } from '@lib/constants';

vi.mock('epubjs');

vi.mock('@data/connection', () => ({
  getConnection: vi.fn(() =>
    Promise.resolve({
      get: vi.fn((store: string) => {
        if (store === 'static_resources')
          return Promise.resolve({ bookId: 'test-book-id', epubBlob: new ArrayBuffer(10) });
        if (store === 'static_manifests')
          return Promise.resolve({
            bookId: 'test-book-id',
            title: 'Test Book',
            author: 'Author',
            fileHash: 'hash',
            fileSize: 100,
            totalChars: 100,
            schemaVersion: CURRENT_BOOK_VERSION,
            coverBlob: new Blob(['']),
          });
        return Promise.resolve(null);
      }),
      getAll: vi.fn(() => Promise.resolve([])),
      getAllFromIndex: vi.fn(() => Promise.resolve([])),
      put: vi.fn(() => Promise.resolve()),
      transaction: vi.fn(() => ({
        objectStore: vi.fn(() => ({
          get: vi.fn(() => Promise.resolve(null)),
          put: vi.fn(() => Promise.resolve()),
        })),
        done: Promise.resolve(),
      })),
    }),
  ),
}));

vi.mock('@lib/search', () => ({
  searchClient: {
    indexBook: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    isIndexed: vi.fn().mockReturnValue(true),
    terminate: vi.fn(),
  },
}));

const BOOK_ID = 'test-book-id';

const makeAnnotation = (over: Partial<UserAnnotation>): UserAnnotation => ({
  id: 'a-1',
  bookId: BOOK_ID,
  cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
  text: 'hello',
  type: 'highlight',
  color: 'yellow',
  created: 1,
  ...over,
});

interface FakeRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

describe('characterization: reader overlay systems (P6 entry gate)', () => {
  const mockDisplay = vi.fn().mockResolvedValue(undefined);
  const mockAnnotations = { add: vi.fn(), remove: vi.fn() };
  const mockGetRange = vi.fn();
  let containerEl: HTMLDivElement;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__reader_added_annotations_count;

    containerEl = document.createElement('div');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ePub as any).mockReturnValue({
      renderTo: vi.fn().mockReturnValue({
        display: mockDisplay,
        prev: vi.fn(),
        next: vi.fn(),
        themes: {
          register: vi.fn(),
          select: vi.fn(),
          fontSize: vi.fn(),
          font: vi.fn(),
          default: vi.fn(),
        },
        annotations: mockAnnotations,
        on: vi.fn(),
        off: vi.fn(),
        getContents: vi.fn(() => []),
        getRange: mockGetRange,
        spread: vi.fn(),
        flow: vi.fn(),
        resize: vi.fn(),
        views: vi.fn().mockReturnValue([]),
        hooks: { content: { register: vi.fn(), deregister: vi.fn() } },
        manager: { container: containerEl },
      }),
      ready: Promise.resolve(),
      loaded: {
        navigation: Promise.resolve({
          toc: [{ id: '1', label: 'Chapter 1', href: 'chap1.html' }],
        }),
      },
      locations: {
        generate: vi.fn().mockResolvedValue(['cfi1']),
        percentageFromCfi: vi.fn(() => 0.5),
        cfiFromPercentage: vi.fn(() => 'epubcfi(/6/4!/4/2)'),
        save: vi.fn(() => '["cfi1"]'),
        load: vi.fn(),
        length: vi.fn(() => 1),
      },
      spine: {
        get: vi.fn(() => ({ label: 'Chapter 1', href: 'chap1.html' })),
      },
      navigation: { get: vi.fn(() => null), forEach: vi.fn() },
      destroy: vi.fn(),
    });

    useReadingStateStore.setState({
      progress: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getProgress: vi.fn(() => null) as any,
    });
    useReaderUIStore.getState().reset();
    useAnnotationStore.setState({ annotations: {} });
    useContentAnalysisStore.setState({ sections: {} });
    act(() => useGenAIStore.getState().setDebugModeEnabled(false));
    usePreferencesStore.setState({
      currentTheme: 'light',
      fontSize: 100,
      lineHeight: 1.5,
      fontProfiles: { en: { fontSize: 100, lineHeight: 1.5 } },
      shouldForceFont: false,
      readerViewMode: 'paginated',
      showPinyin: false,
      forceTraditionalChinese: false,
    });
    useTTSPlaybackStore.setState({ isPlaying: false, activeCfi: null, status: 'stopped' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderReader = () =>
    render(
      <MemoryRouter initialEntries={[`/read/${BOOK_ID}`]}>
        <Routes>
          <Route path="/read/:id" element={<ReaderView />} />
        </Routes>
      </MemoryRouter>,
    );

  const waitForReady = async () => {
    // isRenditionReady flips after rendition.display(); the annotation diff
    // effect publishes the test counter right after.
    await waitFor(() => expect(mockDisplay).toHaveBeenCalled());
  };

  describe('1. user annotation highlights (ReaderView diff effect)', () => {
    it('adds one epub.js highlight per annotation with the color→class mapping', async () => {
      useAnnotationStore.setState({
        annotations: {
          'a-y': makeAnnotation({ id: 'a-y', color: 'yellow', cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:1)' }),
          'a-g': makeAnnotation({ id: 'a-g', color: 'green', cfiRange: 'epubcfi(/6/4!/4/2,/1:1,/1:2)' }),
          'a-b': makeAnnotation({ id: 'a-b', color: 'blue', cfiRange: 'epubcfi(/6/4!/4/2,/1:2,/1:3)' }),
          'a-r': makeAnnotation({ id: 'a-r', color: 'red', cfiRange: 'epubcfi(/6/4!/4/2,/1:3,/1:4)' }),
        },
      });

      renderReader();
      await waitForReady();

      await waitFor(() => expect(mockAnnotations.add).toHaveBeenCalledTimes(4));
      const calls = mockAnnotations.add.mock.calls;
      const byClass = new Map(calls.map((c) => [c[4], c[1]]));
      expect(byClass.get('highlight-yellow')).toBe('epubcfi(/6/4!/4/2,/1:0,/1:1)');
      expect(byClass.get('highlight-green')).toBe('epubcfi(/6/4!/4/2,/1:1,/1:2)');
      expect(byClass.get('highlight-blue')).toBe('epubcfi(/6/4!/4/2,/1:2,/1:3)');
      expect(byClass.get('highlight-red')).toBe('epubcfi(/6/4!/4/2,/1:3,/1:4)');
      // Every call is type 'highlight' with an interactive click handler.
      for (const c of calls) {
        expect(c[0]).toBe('highlight');
        expect(typeof c[3]).toBe('function');
      }
      // The E2E-polled counter reflects the tracked map size.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).__reader_added_annotations_count).toBe(4);
    });

    it('adds audio-bookmark annotations with the pending striped class', async () => {
      useAnnotationStore.setState({
        annotations: {
          'a-ab': makeAnnotation({ id: 'a-ab', type: 'audio-bookmark', color: '' }),
        },
      });

      renderReader();
      await waitForReady();

      await waitFor(() => expect(mockAnnotations.add).toHaveBeenCalledTimes(1));
      const call = mockAnnotations.add.mock.calls[0];
      expect(call[0]).toBe('highlight');
      expect(call[4]).toBe('versicle-audio-bookmark-pending');
    });

    it('removes the epub.js highlight (and decrements the counter) when an annotation is deleted', async () => {
      useAnnotationStore.setState({
        annotations: {
          'a-1': makeAnnotation({ id: 'a-1' }),
          'a-2': makeAnnotation({ id: 'a-2', cfiRange: 'epubcfi(/6/4!/4/2,/1:5,/1:9)' }),
        },
      });

      renderReader();
      await waitForReady();
      await waitFor(() => expect(mockAnnotations.add).toHaveBeenCalledTimes(2));

      act(() => {
        const { annotations } = useAnnotationStore.getState();
        const rest = { ...annotations };
        delete rest['a-1'];
        useAnnotationStore.setState({ annotations: rest });
      });

      await waitFor(() =>
        expect(mockAnnotations.remove).toHaveBeenCalledWith('epubcfi(/6/4!/4/2,/1:0,/1:5)', 'highlight'),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).__reader_added_annotations_count).toBe(1);
    });
  });

  describe('2. content-analysis debug highlights', () => {
    it('adds debug-analysis-highlight when debug mode is on and analysis exists for the current section', async () => {
      useContentAnalysisStore
        .getState()
        .saveReferenceStartCfi(BOOK_ID, 'chap1.html', 'epubcfi(/6/4!/4/10)');

      renderReader();
      await waitForReady();

      act(() => {
        useReaderUIStore.setState({ currentSectionId: 'chap1.html' });
        useGenAIStore.getState().setDebugModeEnabled(true);
      });

      await waitFor(() =>
        expect(mockAnnotations.add).toHaveBeenCalledWith(
          'highlight',
          'epubcfi(/6/4!/4/10)',
          {},
          null,
          'debug-analysis-highlight',
          {
            fill: TYPE_COLORS['reference'],
            backgroundColor: TYPE_COLORS['reference'],
            fillOpacity: '1',
            mixBlendMode: 'multiply',
          },
        ),
      );
    });

    it('removes the debug highlight when debug mode is disabled', async () => {
      useContentAnalysisStore
        .getState()
        .saveReferenceStartCfi(BOOK_ID, 'chap1.html', 'epubcfi(/6/4!/4/10)');

      renderReader();
      await waitForReady();

      act(() => {
        useReaderUIStore.setState({ currentSectionId: 'chap1.html' });
        useGenAIStore.getState().setDebugModeEnabled(true);
      });
      await waitFor(() =>
        expect(mockAnnotations.add).toHaveBeenCalledWith(
          'highlight',
          'epubcfi(/6/4!/4/10)',
          {},
          null,
          'debug-analysis-highlight',
          expect.anything(),
        ),
      );

      act(() => {
        useGenAIStore.getState().setDebugModeEnabled(false);
      });

      await waitFor(() =>
        expect(mockAnnotations.remove).toHaveBeenCalledWith('epubcfi(/6/4!/4/10)', 'highlight'),
      );
    });
  });

  describe('3. note markers (geometry portal into rendition.manager.container)', () => {
    const NOTE_CFI = 'epubcfi(/6/4!/4/2,/1:0,/1:5)';
    const rects: FakeRect[] = [
      { top: 10, left: 5, right: 60, bottom: 30, width: 55, height: 20 },
      { top: 40, left: 5, right: 120, bottom: 60, width: 115, height: 20 },
    ];

    beforeEach(() => {
      mockGetRange.mockImplementation((cfi: string) =>
        cfi === NOTE_CFI ? { getClientRects: () => rects } : null,
      );
      useAnnotationStore.setState({
        annotations: {
          'a-n': makeAnnotation({ id: 'a-n', cfiRange: NOTE_CFI, note: 'my note', type: 'note' }),
        },
      });
    });

    it('renders the marker button at the end of the LAST rect of the range', async () => {
      renderReader();
      await waitForReady();

      await waitFor(() => {
        const marker = containerEl.querySelector('[data-testid="note-marker"]') as HTMLElement;
        expect(marker).toBeTruthy();
        // Placement: top = lastRect.top + iframeOffsetTop(0);
        // left = lastRect.right + iframeOffsetLeft(0) - 4px marker offset.
        expect(marker.style.top).toBe('40px');
        expect(marker.style.left).toBe(`${120 - 4}px`);
        expect(marker.getAttribute('aria-label')).toBe('Note: my note');
      });
    });

    it('ReaderOverlay interactive contract: marker buttons are NOT inside an aria-hidden wrapper', async () => {
      // CHARACTERIZATION DELTA (deliberate, prep doc §4): the entry-gate pin
      // recorded the old defect — focusable buttons inside an aria-hidden
      // overlay (the app-shell a11y finding). The ReaderOverlay interactive
      // contract fixed it: the overlay group is exposed to the a11y tree
      // with an accessible name, and the buttons inside it are reachable.
      renderReader();
      await waitForReady();

      await waitFor(() => {
        const marker = containerEl.querySelector('[data-testid="note-marker"]') as HTMLElement;
        expect(marker).toBeTruthy();
        expect(marker.closest('[aria-hidden="true"]')).toBeNull();
        const group = marker.closest('[role="group"]');
        expect(group).not.toBeNull();
        expect(group!.getAttribute('aria-label')).toBe('Annotation notes');
      });
    });
  });
});
