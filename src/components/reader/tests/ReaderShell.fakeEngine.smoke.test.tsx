/**
 * Renderer-swap smoke (contract C7 acceptance, Phase 6 §2b): the reader
 * shell boots on the FakeReaderEngine in jsdom — no epub.js anywhere in the
 * render path. This is the proof that swapping the rendering engine (e.g.
 * to foliate-js) is a one-module change: every component consumes the
 * ReaderEngine port, never the renderer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ReaderView } from '../ReaderView';
import { FakeReaderEngine } from '@domains/reader/engine/FakeReaderEngine';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useAnnotationStore } from '@store/useAnnotationStore';

const fakeEngine = new FakeReaderEngine();
const displaySpy = vi.spyOn(fakeEngine, 'display');

vi.mock('@hooks/useEpubReader', () => ({
  useEpubReader: () => ({
    engine: fakeEngine,
    book: null,
    isReady: true,
    areLocationsReady: true,
    isLoading: false,
    metadata: null,
    toc: fakeEngine.getToc(),
    error: null,
  }),
}));

vi.mock('@lib/search', () => ({
  searchClient: {
    indexBook: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    isIndexed: vi.fn().mockReturnValue(true),
    terminate: vi.fn(),
  },
}));

describe('renderer-swap smoke: ReaderView boots on FakeReaderEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReaderUIStore.getState().reset();
    useAnnotationStore.setState({ annotations: {} });
    useReadingStateStore.setState({
      progress: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getProgress: vi.fn(() => null) as any,
    });
    usePreferencesStore.setState({
      currentTheme: 'light',
      fontSize: 100,
      lineHeight: 1.5,
      fontProfiles: {},
      shouldForceFont: false,
      readerViewMode: 'paginated',
      showPinyin: false,
      forceTraditionalChinese: false,
    });
    useTTSPlaybackStore.setState({ isPlaying: false, activeCfi: null, status: 'stopped' });
  });

  const renderShell = () =>
    render(
      <MemoryRouter initialEntries={['/read/fake-book']}>
        <Routes>
          <Route path="/read/:id" element={<ReaderView />} />
        </Routes>
      </MemoryRouter>,
    );

  it('renders the full reader chrome without any epub.js renderer', async () => {
    renderShell();

    await waitFor(() => {
      expect(screen.getByTestId('reader-view')).toBeInTheDocument();
      expect(screen.getByTestId('reader-header')).toBeInTheDocument();
      expect(screen.getByTestId('reader-iframe-container')).toBeInTheDocument();
    });
  });

  it('navigates sections through the port (TOC → engine.display)', async () => {
    renderShell();
    act(() => {
      useReaderUIStore.setState({ toc: fakeEngine.getToc() });
    });

    fireEvent.click(screen.getByTestId('reader-toc-button'));
    await waitFor(() => expect(screen.getByTestId('reader-toc-sidebar')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Chapter 2'));
    await waitFor(() => expect(displaySpy).toHaveBeenCalledWith('chapter2.xhtml'));
    expect(fakeEngine.currentLocation()?.sectionHref).toBe('chapter2.xhtml');
  });
});
