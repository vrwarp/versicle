import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReaderTTSController } from '../ReaderTTSController';
import { useTTSStore } from '../../../store/useTTSStore';

// Mock the store
const mockGetState = vi.fn();

vi.mock('../../../store/useTTSStore', () => ({
  useTTSStore: Object.assign(vi.fn(), {
    getState: () => mockGetState(),
  }),
}));

describe('ReaderTTSController', () => {
  let jumpToMock: ReturnType<typeof vi.fn>;
  let onNextMock: ReturnType<typeof vi.fn>;
  let onPrevMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jumpToMock = vi.fn();
    onNextMock = vi.fn();
    onPrevMock = vi.fn();
    mockGetState.mockReturnValue({
        activeCfi: 'cfi-1',
        status: 'playing',
    });

    // Default store mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useTTSStore as any).mockImplementation((selector: any) => {
        const state = {
            activeCfi: 'cfi-1',
            currentIndex: 1,
            status: 'playing',
            queue: ['item1', 'item2', 'item3'],
            jumpTo: jumpToMock
        };
        return selector(state);
    });
  });

  it('ignores arrow keys when an input is focused', () => {
    render(
      <ReaderTTSController
        rendition={null}
        viewMode="scrolled"
        onNext={onNextMock}
        onPrev={onPrevMock}
      />
    );

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    // Fire event on the input, so it bubbles to window and e.target is the input
    fireEvent.keyDown(input, { key: 'ArrowLeft', bubbles: true });
    expect(jumpToMock).not.toHaveBeenCalled();
    expect(onPrevMock).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'ArrowRight', bubbles: true });
    expect(jumpToMock).not.toHaveBeenCalled();
    expect(onNextMock).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

    it('ignores arrow keys when a textarea is focused', () => {
    render(
      <ReaderTTSController
        rendition={null}
        viewMode="scrolled"
        onNext={onNextMock}
        onPrev={onPrevMock}
      />
    );

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    // Fire event on the textarea
    fireEvent.keyDown(textarea, { key: 'ArrowLeft', bubbles: true });
    expect(jumpToMock).not.toHaveBeenCalled();
    expect(onPrevMock).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'ArrowRight', bubbles: true });
    expect(jumpToMock).not.toHaveBeenCalled();
    expect(onNextMock).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

    it('responds to arrow keys when no input is focused', () => {
    render(
      <ReaderTTSController
        rendition={null}
        viewMode="scrolled"
        onNext={onNextMock}
        onPrev={onPrevMock}
      />
    );

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
    };

    render(
      <ReaderTTSController
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rendition={mockRendition as any}
        viewMode="paginated"
        onNext={onNextMock}
        onPrev={onPrevMock}
      />
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
