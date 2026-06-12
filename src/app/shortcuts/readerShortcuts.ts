/**
 * Reader + TTS shortcut registrants (Phase 8 §E) — the production
 * registrations that replaced the two deleted window keydown registries.
 * The P0 keyboard-gating predicates died here: ownership is expressed as
 * scope stacking ('tts-active' over 'reader'), not as each listener
 * peeking at the other's state.
 *
 *  - {@link useReaderPageTurnShortcuts}: ArrowLeft/ArrowRight page turns
 *    (scope 'reader') — the keyboard half of the deleted
 *    useReaderNavigation registry; wheel/touch stayed in that hook.
 *  - {@link useTtsPlaybackShortcuts}: sentence jumps + Space play/pause +
 *    Escape stop (scope 'tts-active', live while playing|paused) — the
 *    deleted ReaderTTSController registry.
 *  - {@link useReaderEngineKeyBridge}: the ONE iframe bridge — forwards
 *    the engine's iframe keydown stream (C7 port event) into the service,
 *    so every policy and scope applies identically with focus inside the
 *    book text (the P0 hotfix path).
 */
import { useEffect } from 'react';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import { keyboardShortcutService } from './KeyboardShortcutService';
import { useShortcut } from './useShortcut';

export interface ReaderPageTurnHandlers {
  handlePrev: () => void;
  handleNext: () => void;
}

/** ArrowLeft/ArrowRight page turns — scope 'reader'. */
export function useReaderPageTurnShortcuts({ handlePrev, handleNext }: ReaderPageTurnHandlers): void {
  useShortcut({
    id: 'reader.prevPage',
    key: 'ArrowLeft',
    scope: 'reader',
    preventDefault: true,
    descriptionKey: 'shortcuts.reader.prevPage',
    handler: () => handlePrev(),
  });
  useShortcut({
    id: 'reader.nextPage',
    key: 'ArrowRight',
    scope: 'reader',
    preventDefault: true,
    descriptionKey: 'shortcuts.reader.nextPage',
    handler: () => handleNext(),
  });
}

export interface TtsPlaybackHandlers {
  play: () => void;
  pause: () => void;
  stop: () => void;
  jumpTo: (index: number) => void;
}

/** The 'tts-active' scope is live exactly while playing|paused. */
function ttsOwnsKeys(): boolean {
  const status = useTTSPlaybackStore.getState().status;
  return status === 'playing' || status === 'paused';
}

/**
 * TTS playback keys — scope 'tts-active'. While playing|paused these win
 * the arrows from the reader scope (sentence jumps, not page turns);
 * in every other status the `when()` predicate stands down and the keys
 * fall through to 'reader'.
 */
export function useTtsPlaybackShortcuts({ play, pause, stop, jumpTo }: TtsPlaybackHandlers): void {
  useShortcut({
    id: 'tts.prevSentence',
    key: 'ArrowLeft',
    scope: 'tts-active',
    when: ttsOwnsKeys,
    descriptionKey: 'shortcuts.tts.prevSentence',
    handler: () => {
      const { currentIndex } = useTTSPlaybackStore.getState();
      if (currentIndex > 0) jumpTo(currentIndex - 1);
    },
  });
  useShortcut({
    id: 'tts.nextSentence',
    key: 'ArrowRight',
    scope: 'tts-active',
    when: ttsOwnsKeys,
    descriptionKey: 'shortcuts.tts.nextSentence',
    handler: () => {
      const { currentIndex, queue } = useTTSPlaybackStore.getState();
      if (currentIndex < queue.length - 1) jumpTo(currentIndex + 1);
    },
  });
  useShortcut({
    id: 'tts.playPause',
    key: ' ',
    scope: 'tts-active',
    when: ttsOwnsKeys,
    preventDefault: true,
    descriptionKey: 'shortcuts.tts.playPause',
    handler: () => {
      const { status } = useTTSPlaybackStore.getState();
      if (status === 'playing') pause();
      else play();
    },
  });
  useShortcut({
    id: 'tts.stop',
    key: 'Escape',
    scope: 'tts-active',
    when: ttsOwnsKeys,
    preventDefault: true,
    descriptionKey: 'shortcuts.tts.stop',
    handler: () => stop(),
  });
}

/**
 * Forward the engine's iframe keydown stream into the service — keys
 * pressed with focus inside the book text behave exactly like window
 * keys (one bridge, registered by the reader feature, per §E).
 */
export function useReaderEngineKeyBridge(engine: ReaderEngine | null): void {
  useEffect(() => {
    if (!engine) return;
    return engine.subscribe((event) => {
      if (event.type === 'keydown') {
        keyboardShortcutService.handleKeyEvent(event.event);
      }
    });
  }, [engine]);
}
