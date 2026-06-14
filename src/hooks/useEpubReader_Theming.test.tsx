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
import React, { useRef } from 'react';
import { render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useEpubReader, type EpubReaderOptions } from './useEpubReader';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useBookStore } from '@store/useBookStore';

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
