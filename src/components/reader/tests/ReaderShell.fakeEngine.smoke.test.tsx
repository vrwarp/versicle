/**
 * Renderer-swap smoke (contract C7 acceptance, Phase 6 §2b): the reader
 * shell boots on the FakeReaderEngine in jsdom — no epub.js anywhere in the
 * render path. This is the proof that swapping the rendering engine (e.g.
 * to foliate-js) is a one-module change: every component consumes the
 * ReaderEngine port, never the renderer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { ReaderShell } from '../ReaderShell';
import { SearchSession } from '@domains/search';
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
          <Route path="/read/:id" element={<ReaderShell />} />
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

    // P6 a11y landmark fix (P0 baseline: reader body outside any landmark
    // region): the content area is a real <main>, the header a banner.
    expect(screen.getByRole('main', { name: 'Book' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
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

  /**
   * React Router reuses the `/read/:id` element across a /read/A -> /read/B
   * navigation, so the shell (and the controller's refs) survive the book
   * change. The controller's per-book singletons — the SearchSession with its
   * worker + corpus cache, and the search navigator — were built once per HOOK
   * INSTANCE and disposed only on unmount, so book B would have been served
   * book A's index.
   */
  describe('regression: a book change retires the previous search session', () => {
    const Navigator: React.FC = () => {
      const navigate = useNavigate();
      return (
        <button data-testid="go-to-book-b" onClick={() => navigate('/read/fake-book-b')}>
          Open book B
        </button>
      );
    };

    it('disposes the previous session and builds a new one for the new book', async () => {
      const dispose = vi.spyOn(SearchSession.prototype, 'dispose');

      const view = render(
        <MemoryRouter initialEntries={['/read/fake-book-a']}>
          <Navigator />
          <Routes>
            <Route path="/read/:id" element={<ReaderShell />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => expect(screen.getByTestId('reader-view')).toBeInTheDocument());
      expect(dispose).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('go-to-book-b'));

      // Book A's session is retired the moment the id changes...
      await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('reader-view')).toBeInTheDocument();

      // ...and a LIVE session exists for book B — the unmount retires it too.
      view.unmount();
      expect(dispose).toHaveBeenCalledTimes(2);
    });
  });
});
