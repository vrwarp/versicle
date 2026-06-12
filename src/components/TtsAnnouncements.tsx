import type React from 'react';
import { useEffect } from 'react';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { announce } from '@kernel/locale/announcer';

/** Debounce window for section-change announcements while playing. */
const SECTION_ANNOUNCE_DEBOUNCE_MS = 1000;

/**
 * TTS playback announcements for screen-reader users (Phase 8 §D, a11y
 * item 2): a headless adapter that subscribes to the playback store and
 * announces STATE TRANSITIONS — "Playing — {section}", "Paused",
 * "Stopped" — plus debounced section changes while playing.
 *
 * NEVER per-sentence by construction: the subscription reads only
 * `status` (and the current section title); `currentIndex`/`activeCfi`
 * are deliberately not observed.
 *
 * Mounted once in RootLayout, beside the LiveAnnouncer that renders the
 * regions this writes into.
 */
export const TtsAnnouncements: React.FC = () => {
  useEffect(() => {
    let lastStatus = useTTSPlaybackStore.getState().status;
    let lastSection = useReaderUIStore.getState().currentSectionTitle;
    let sectionTimer: ReturnType<typeof setTimeout> | null = null;

    const sectionLabel = () =>
      useReaderUIStore.getState().currentSectionTitle || 'current section';

    const unsubscribeStatus = useTTSPlaybackStore.subscribe((state) => {
      if (state.status === lastStatus) return;
      const previous = lastStatus;
      lastStatus = state.status;

      if (state.status === 'playing') {
        announce({ key: 'announce.tts.playing', params: { section: sectionLabel() } });
      } else if (state.status === 'paused') {
        announce('announce.tts.paused');
      } else if (state.status === 'stopped' && (previous === 'playing' || previous === 'paused')) {
        announce('announce.tts.stopped');
      }
    });

    // Section changes while PLAYING announce (debounced — section flips
    // can ripple during a jump); paused/stopped section changes are the
    // user navigating visually and stay silent.
    const unsubscribeSection = useReaderUIStore.subscribe((state) => {
      const title = state.currentSectionTitle;
      if (title === lastSection) return;
      lastSection = title;
      if (useTTSPlaybackStore.getState().status !== 'playing' || !title) return;
      if (sectionTimer) clearTimeout(sectionTimer);
      sectionTimer = setTimeout(() => {
        announce({ key: 'announce.tts.playing', params: { section: title } });
      }, SECTION_ANNOUNCE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribeStatus();
      unsubscribeSection();
      if (sectionTimer) clearTimeout(sectionTimer);
    };
  }, []);

  return null;
};
