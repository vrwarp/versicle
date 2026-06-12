import type { ReactElement } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReaderTTSController } from '../ReaderTTSController';
import { HighlightLayerManager, type AnnotatingRendition } from '@domains/reader/engine/HighlightLayerManager';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import { ReaderCommandsProvider, type ReaderCommands } from '@domains/reader/ui/ReaderCommands';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';

// The controller rides the ReaderCommands context for the engine (Phase 6
// §5a) — the provider stands in for the shell.
const noopCommands: ReaderCommands = {
  jumpTo: () => { }, nextPage: () => { }, prevPage: () => { },
  nextChapter: () => { }, prevChapter: () => { },
  playFromSelection: () => { }, scrollToText: () => { },
  refineSelection: () => null,
};
const withEngine = (engine: ReaderEngine | null, ui: ReactElement) => (
  <ReaderCommandsProvider commands={noopCommands} engine={engine}>{ui}</ReaderCommandsProvider>
);

// Mock the store + the command facade (engine commands moved to
// useAudioCommands at Phase 5b-PR1).
const mockGetState = vi.fn();
const { jumpToMock } = vi.hoisted(() => ({ jumpToMock: vi.fn() }));

vi.mock('@store/useTTSPlaybackStore', () => ({
  useTTSPlaybackStore: Object.assign(vi.fn(), {
    getState: () => mockGetState(),
  }),
}));

vi.mock('@app/tts/useAudioCommands', () => ({
  useAudioCommands: () => ({
    jumpTo: jumpToMock,
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
  }),
}));

describe('ReaderTTSController', () => {
  beforeEach(() => {
    jumpToMock.mockClear();
    mockGetState.mockReturnValue({
        activeCfi: 'cfi-1',
        status: 'playing',
    });

    // Default store mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useTTSPlaybackStore as any).mockImplementation((selector: any) => {
        const state = {
            activeCfi: 'cfi-1',
            currentIndex: 1,
            status: 'playing',
            queue: ['item1', 'item2', 'item3']
        };
        return selector(state);
    });
  });

  it('ignores arrow keys when an input is focused', () => {
    render(withEngine(null, <ReaderTTSController viewMode="scrolled" />));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    // Fire event on the input, so it bubbles to window and e.target is the input
    fireEvent.keyDown(input, { key: 'ArrowLeft', bubbles: true });
    expect(jumpToMock).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'ArrowRight', bubbles: true });
    expect(jumpToMock).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

    it('ignores arrow keys when a textarea is focused', () => {
    render(withEngine(null, <ReaderTTSController viewMode="scrolled" />));

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    // Fire event on the textarea
    fireEvent.keyDown(textarea, { key: 'ArrowLeft', bubbles: true });
    expect(jumpToMock).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'ArrowRight', bubbles: true });
    expect(jumpToMock).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

    it('responds to arrow keys when no input is focused', () => {
    render(withEngine(null, <ReaderTTSController viewMode="scrolled" />));

    // Make sure body is focused or nothing specific
    document.body.focus();

    // Fire on body or window (bubbling from body)
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', bubbles: true });
    expect(jumpToMock).toHaveBeenCalledWith(0); // index - 1
  });

  it('syncs position when returning to foreground', () => {
    const displayMock = vi.fn().mockResolvedValue(undefined);
    const annotationsAddMock = vi.fn();
    const annotationsRemoveMock = vi.fn();

    const mockRendition = {
      display: displayMock,
      annotations: {
        add: annotationsAddMock,
        remove: annotationsRemoveMock,
      },
      views: vi.fn().mockReturnValue([]),
    };

    render(
      withEngine(
        {
          display: mockRendition.display,
          highlights: new HighlightLayerManager(mockRendition as unknown as AnnotatingRendition),
        } as unknown as ReaderEngine,
        <ReaderTTSController viewMode="paginated" />,
      )
    );

    // Mock store state update (simulating background update)
    mockGetState.mockReturnValue({
        activeCfi: 'cfi-updated',
        status: 'playing',
    });

    // Simulate visibility change to visible
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
    fireEvent(document, new Event('visibilitychange'));

    expect(displayMock).toHaveBeenCalledWith('cfi-updated');
    expect(annotationsRemoveMock).toHaveBeenCalledWith('cfi-updated', 'highlight');
    expect(annotationsAddMock).toHaveBeenCalledWith('highlight', 'cfi-updated', {}, expect.any(Function), 'tts-highlight');
  });
});
