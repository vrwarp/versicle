/**
 * Theme-change reflow semantics (Phase 6 PR-4 / D5,
 * prep/phase6-reader-engine.md §2b "Theming semantics").
 *
 * The legacy settings effect called `flow()` + `display(currentLoc)` on
 * EVERY input change — a theme/font tweak reflowed the book and fired a
 * spurious relocation event (which feeds the session recorder). D5: the
 * reflow happens ONLY when the view mode actually changed. This suite pins
 * the hook-level behavior; epubTheming.test.ts pins the module parameter.
 */
import React, { useEffect, useRef } from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useEpubReader, type EpubReaderOptions } from './useEpubReader';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useBookStore } from '@store/useBookStore';
import type { BookMetadata } from '~types/book';

vi.mock('@data/repos/bookContent', () => ({
  bookContent: {
    getBookFile: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    getLocations: vi.fn().mockResolvedValue(null),
    saveLocations: vi.fn().mockResolvedValue(undefined),
  },
}));

const slot = vi.hoisted(() => ({
  flow: null as ReturnType<typeof vi.fn> | null,
  display: null as ReturnType<typeof vi.fn> | null,
  select: null as ReturnType<typeof vi.fn> | null,
}));

vi.mock('epubjs', () => ({
  default: vi.fn().mockImplementation(() => ({
    renderTo: vi.fn().mockImplementation((element: HTMLElement) => {
      const iframe = document.createElement('iframe');
      element.appendChild(iframe);
      slot.flow = vi.fn();
      slot.display = vi.fn().mockResolvedValue(undefined);
      slot.select = vi.fn();
      return {
        themes: {
          register: vi.fn(),
          select: slot.select,
          fontSize: vi.fn(),
          font: vi.fn(),
          default: vi.fn(),
        },
        display: slot.display,
        on: vi.fn(),
        off: vi.fn(),
        hooks: { content: { register: vi.fn() } },
        spread: vi.fn(),
        flow: slot.flow,
        resize: vi.fn(),
        getRange: vi.fn(),
        getContents: vi.fn(() => []),
        location: { start: { cfi: 'epubcfi(/6/4!/4/2)' } },
      };
    }),
    loaded: { navigation: Promise.resolve({ toc: [] }) },
    ready: Promise.resolve(),
    destroy: vi.fn(),
    locations: {
      generate: vi.fn().mockResolvedValue(undefined),
      save: vi.fn(() => '[]'),
      load: vi.fn(),
      percentageFromCfi: vi.fn(),
      length: vi.fn(() => 0),
    },
    spine: { get: vi.fn(), hooks: { serialize: { register: vi.fn() } } },
  })),
}));

const TestHost: React.FC<{ theme?: string; viewMode?: 'paginated' | 'scrolled' }> = ({
  theme = 'light',
  viewMode = 'paginated',
}) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const options: EpubReaderOptions = {
    viewMode,
    currentTheme: theme,
    customTheme: { bg: '#fff', fg: '#000' },
    fontFamily: 'serif',
    fontSize: 100,
    lineHeight: 1.5,
    shouldForceFont: false,
  };
  useEpubReader('theming-book', viewerRef as unknown as React.RefObject<HTMLElement>, options);
  return <div ref={viewerRef} data-testid="viewer" />;
};

describe('regression: theme change does not reflow (D5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    slot.flow = null;
    useBookStore.setState({ books: {} });
    usePreferencesStore.setState({
      showPinyin: false,
      forceTraditionalChinese: false,
      pinyinSize: 100,
    });
  });

  const boot = async () => {
    const view = render(<TestHost />);
    // The settings effect ran at least once post-ready.
    await waitFor(() => expect(slot.select).toHaveBeenCalled());
    return view;
  };

  it('initial application never reflows (renderTo already has the mode)', async () => {
    await boot();
    expect(slot.flow).not.toHaveBeenCalled();
  });

  it('initial theme application re-displays to correct potential layout shifts', async () => {
    await boot();
    // 1st call: initial book display (startLocation)
    // 2nd call: post-theming re-scroll
    expect(slot.display).toHaveBeenCalledTimes(2);
    // Verified it re-displays the current location (which defaults to book location in mock)
    expect(slot.display).toHaveBeenLastCalledWith('epubcfi(/6/4!/4/2)');
  });

  it('a theme-only change re-themes without flow()/display()', async () => {
    const view = await boot();
    slot.display!.mockClear();

    view.rerender(<TestHost theme="dark" />);

    await waitFor(() => expect(slot.select).toHaveBeenCalledWith('dark'));
    expect(slot.flow).not.toHaveBeenCalled();
    expect(slot.display).not.toHaveBeenCalled();
  });

  it('a view-mode change reflows and restores the location', async () => {
    const view = await boot();
    slot.display!.mockClear();

    view.rerender(<TestHost viewMode="scrolled" />);

    await waitFor(() => expect(slot.flow).toHaveBeenCalledWith('scrolled-doc'));
    expect(slot.display).toHaveBeenCalledWith('epubcfi(/6/4!/4/2)');
  });
});

/**
 * The app hands this hook a LIVE library projection: `useBook` returns a new
 * object on every progress write (every page turn, every TTS sentence), and
 * the metadata effect used to `setMetadata` it unconditionally — committing a
 * SECOND full render pass of the host (the whole reader tree, none of which is
 * memoized) for fields the hook never reads.
 */
describe('regression: a progress-only metadata change does not re-render the reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    slot.flow = null;
    useBookStore.setState({ books: {} });
    usePreferencesStore.setState({
      showPinyin: false,
      forceTraditionalChinese: false,
      pinyinSize: 100,
    });
  });

  const BASE_METADATA: BookMetadata = {
    id: 'metadata-book',
    title: 'Metadata Book',
    author: 'Author',
    addedAt: 0,
    baseFontSize: 16,
    baseLineHeight: 24,
    progress: 0.1,
    currentCfi: 'epubcfi(/6/4!/4/2)',
  };

  // Commit counter, bumped from a dep-less effect (one run per commit) so the
  // test can assert how many render passes one prop change costs.
  let commits = 0;

  const MetadataHost: React.FC<{ metadata: BookMetadata }> = ({ metadata }) => {
    const viewerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      commits += 1;
    });
    const options: EpubReaderOptions = {
      viewMode: 'paginated',
      currentTheme: 'light',
      customTheme: { bg: '#fff', fg: '#000' },
      fontFamily: 'serif',
      fontSize: 100,
      lineHeight: 1.5,
      shouldForceFont: false,
      metadata,
    };
    useEpubReader('metadata-book', viewerRef as unknown as React.RefObject<HTMLElement>, options);
    return <div ref={viewerRef} data-testid="viewer" />;
  };

  /** Let the async load pipeline finish committing before counting. */
  const settle = async () => {
    let previous = -1;
    for (let i = 0; i < 20 && previous !== commits; i += 1) {
      previous = commits;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  it('commits once for a re-render whose consumed metadata fields are unchanged', async () => {
    commits = 0;
    const view = render(<MetadataHost metadata={BASE_METADATA} />);
    await waitFor(() => expect(slot.select).toHaveBeenCalled());
    await settle();

    const before = commits;

    // A progress write: a NEW object, same theme-relevant fields.
    view.rerender(
      <MetadataHost metadata={{ ...BASE_METADATA, progress: 0.2, currentCfi: 'epubcfi(/6/6!/4/2)' }} />,
    );
    await settle();

    // Exactly the caller's own render — no extra commit from setMetadata.
    expect(commits).toBe(before + 1);
  });

  it('still commits when a consumed metadata field changes', async () => {
    commits = 0;
    const view = render(<MetadataHost metadata={BASE_METADATA} />);
    await waitFor(() => expect(slot.select).toHaveBeenCalled());
    await settle();

    const before = commits;

    view.rerender(<MetadataHost metadata={{ ...BASE_METADATA, baseFontSize: 20 }} />);
    await settle();

    expect(commits).toBeGreaterThan(before + 1);
  });
});
