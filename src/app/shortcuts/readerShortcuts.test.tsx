/**
 * Reader/TTS shortcut integration — the §E acceptance matrix: with BOTH
 * production registrants mounted (page turns + TTS playback keys, exactly
 * as the reader shell composes them), one ArrowRight is exactly ONE
 * action in every TTS state, for window keys and for the forwarded
 * iframe keydown stream alike.
 *
 * Absorbs (test-absorption ledger, rule 8) the keyboard assertions of the
 * deleted src/hooks/useReaderNavigation.test.ts — the hook lost its
 * keyboard half (and the P0 interim predicate) to the
 * KeyboardShortcutService.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyboardShortcutHost } from './KeyboardShortcutHost';
import {
  useReaderPageTurnShortcuts,
  useTtsPlaybackShortcuts,
  useReaderEngineKeyBridge,
} from './readerShortcuts';
import { keyboardShortcutService } from './KeyboardShortcutService';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { autoResetStores, makeTTSQueue, seedStore } from '@test/harness';
import { FakeReaderEngine } from '@domains/reader/engine/FakeReaderEngine';
import type { TTSStatus } from '@lib/tts/engine/TtsEngine';

const handlePrev = vi.fn();
const handleNext = vi.fn();
const play = vi.fn();
const pause = vi.fn();
const stop = vi.fn();
const jumpTo = vi.fn();

/** Both production registrants, composed exactly like the reader shell. */
const Harness: React.FC<{ engine?: FakeReaderEngine | null }> = ({ engine = null }) => {
  useReaderPageTurnShortcuts({ handlePrev, handleNext });
  useTtsPlaybackShortcuts({ play, pause, stop, jumpTo });
  useReaderEngineKeyBridge(engine);
  return <KeyboardShortcutHost />;
};

const setStatus = (status: TTSStatus, queueLength = 5, currentIndex = 1) => {
  seedStore(useTTSPlaybackStore, {
    status,
    isPlaying: status === 'playing',
    queue: makeTTSQueue(queueLength),
    currentIndex,
  });
};

describe('reader keyboard matrix (Phase 8 §E acceptance)', () => {
  autoResetStores(useTTSPlaybackStore);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['stopped', 'loading', 'completed'] as const)(
    'one ArrowRight = ONE page turn (zero jumps) while %s',
    (status) => {
      setStatus(status);
      render(<Harness />);
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(handleNext).toHaveBeenCalledTimes(1);
      expect(jumpTo).not.toHaveBeenCalled();
    },
  );

  it.each(['playing', 'paused'] as const)(
    'one ArrowRight = ONE sentence jump (zero page turns) while %s',
    (status) => {
      setStatus(status);
      render(<Harness />);
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(jumpTo).toHaveBeenCalledTimes(1);
      expect(jumpTo).toHaveBeenCalledWith(2);
      expect(handleNext).not.toHaveBeenCalled();
    },
  );

  it('ArrowLeft mirrors: page turn when stopped, sentence jump when playing', () => {
    setStatus('stopped');
    const view = render(<Harness />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(handlePrev).toHaveBeenCalledTimes(1);
    view.unmount();

    vi.clearAllMocks();
    setStatus('playing');
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(jumpTo).toHaveBeenCalledWith(0);
    expect(handlePrev).not.toHaveBeenCalled();
  });

  it('queue boundaries: the jump handler consumes the key WITHOUT page-turning', () => {
    setStatus('playing', 5, 0);
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(jumpTo).not.toHaveBeenCalled();
    expect(handlePrev).not.toHaveBeenCalled(); // consumed by tts-active, no fall-through

    setStatus('playing', 5, 4);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(jumpTo).not.toHaveBeenCalled();
    expect(handleNext).not.toHaveBeenCalled();
  });

  it('Space toggles play/pause while listening; does nothing when stopped', () => {
    setStatus('playing');
    render(<Harness />);
    fireEvent.keyDown(window, { key: ' ' });
    expect(pause).toHaveBeenCalledTimes(1);

    setStatus('paused');
    fireEvent.keyDown(window, { key: ' ' });
    expect(play).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    setStatus('stopped');
    fireEvent.keyDown(window, { key: ' ' });
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it('Space on a focused button activates the button only (no playback toggle)', () => {
    setStatus('playing');
    render(<Harness />);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    const notPrevented = fireEvent.keyDown(button, { key: ' ' });
    expect(pause).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true); // no preventDefault — the button keeps Space

    document.body.removeChild(button);
  });

  it('Escape: closes an open sheet first (audio keeps playing), stops playback otherwise', () => {
    setStatus('playing');
    render(<Harness />);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.appendChild(dialog);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(stop).not.toHaveBeenCalled();

    document.body.removeChild(dialog);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  describe('regression: overlapping global keyboard registries (keyboard-gating hotfix, absorbed from useReaderNavigation.test)', () => {
    it('does not turn the page on arrows while TTS is playing (sentence jumps own them)', () => {
      setStatus('playing');
      render(<Harness />);
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      expect(handleNext).not.toHaveBeenCalled();
      expect(handlePrev).not.toHaveBeenCalled();
    });

    it('resumes page turns as soon as TTS stops, without re-mounting', () => {
      setStatus('playing');
      render(<Harness />);
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(handleNext).not.toHaveBeenCalled();

      setStatus('stopped');
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(handleNext).toHaveBeenCalledTimes(1);
    });

    it('ignores key auto-repeat', () => {
      setStatus('stopped');
      render(<Harness />);
      fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
      expect(handleNext).not.toHaveBeenCalled();
    });

    it('ignores arrows while typing in an input field', () => {
      setStatus('stopped');
      render(<Harness />);
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      fireEvent.keyDown(input, { key: 'ArrowRight', bubbles: true });
      expect(handleNext).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it('gates the engine (iframe) keydown stream the same way — ONE bridge, same policies', () => {
      const engine = new FakeReaderEngine();
      setStatus('stopped');
      render(<Harness engine={engine} />);

      const makeEvent = (overrides: Partial<KeyboardEvent> = {}) =>
        ({ key: 'ArrowRight', repeat: false, cancelable: false, target: null, ...overrides }) as unknown as KeyboardEvent;

      engine.emit({ type: 'keydown', event: makeEvent() });
      expect(handleNext).toHaveBeenCalledTimes(1);

      // While playing, the same stream drives sentence jumps, not pages.
      vi.clearAllMocks();
      setStatus('playing');
      engine.emit({ type: 'keydown', event: makeEvent() });
      expect(jumpTo).toHaveBeenCalledWith(2);
      expect(handleNext).not.toHaveBeenCalled();
    });
  });

  describe('help sheet (?)', () => {
    it('opens a GENERATED sheet listing the live registrations', async () => {
      setStatus('stopped');
      const { findByTestId } = render(<Harness />);
      fireEvent.keyDown(window, { key: '?' });

      const sheet = await findByTestId('shortcut-help-sheet');
      expect(sheet.textContent).toContain('Previous page');
      expect(sheet.textContent).toContain('Next page');
      expect(sheet.textContent).toContain('Play / pause audio');
      expect(sheet.textContent).toContain('Show keyboard shortcuts');
    });

    it('typing ? in an input does not open the sheet (input guard applies)', () => {
      setStatus('stopped');
      const { queryByTestId } = render(<Harness />);
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      fireEvent.keyDown(input, { key: '?', bubbles: true });
      expect(queryByTestId('shortcut-help-sheet')).toBeNull();

      document.body.removeChild(input);
    });
  });

  it('exactly ONE window listener: unmount leaves no registrations behind', () => {
    setStatus('stopped');
    const view = render(<Harness />);
    expect(keyboardShortcutService.getRegistrations().length).toBeGreaterThan(0);
    view.unmount();
    expect(keyboardShortcutService.getRegistrations().length).toBe(0);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(handleNext).not.toHaveBeenCalled();
  });
});
