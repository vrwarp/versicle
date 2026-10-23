import React, { useEffect, useState } from 'react';
import { subscribeAnnouncements } from '@kernel/locale/announcer';

/** How long announced text stays in a region before it is emptied. */
const STALE_TEXT_CLEAR_MS = 10_000;

/**
 * The screen-reader announcement outlet:
 * two PERSISTENT visually-hidden live regions (polite + assertive),
 * mounted once in RootLayout. Non-React code announces through
 * `announce()` (src/kernel/locale/announcer.ts); this component only
 * injects the text.
 *
 * Re-announcement of identical text works by clearing the region first
 * and writing the new text on the next frame (the standard live-region
 * "nudge" — most screen readers ignore a mutation that leaves the text
 * unchanged).
 */
export const LiveAnnouncer: React.FC = () => {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');

  useEffect(() => {
    // Per-region frame/timer handles: a shared handle let an announcement on
    // one region cancel the pending write or stale-text clear of the other.
    const makeChannel = (set: (text: string) => void) => {
      let raf = 0;
      let clearTimer: ReturnType<typeof setTimeout> | null = null;
      return {
        announce(text: string) {
          // Clear, then write next frame so identical text re-announces.
          set('');
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            set(text);
            // Empty the region a while after announcing so stale text is not
            // re-read when a user walks the accessibility tree later.
            if (clearTimer) clearTimeout(clearTimer);
            clearTimer = setTimeout(() => set(''), STALE_TEXT_CLEAR_MS);
          });
        },
        dispose() {
          cancelAnimationFrame(raf);
          if (clearTimer) clearTimeout(clearTimer);
        },
      };
    };
    const politeChannel = makeChannel(setPolite);
    const assertiveChannel = makeChannel(setAssertive);
    const unsubscribe = subscribeAnnouncements((announcement) => {
      (announcement.assertive ? assertiveChannel : politeChannel).announce(announcement.text);
    });
    return () => {
      unsubscribe();
      politeChannel.dispose();
      assertiveChannel.dispose();
    };
  }, []);

  return (
    <>
      <div data-testid="live-announcer-polite" role="status" aria-live="polite" className="sr-only">
        {polite}
      </div>
      <div data-testid="live-announcer-assertive" role="alert" aria-live="assertive" className="sr-only">
        {assertive}
      </div>
    </>
  );
};
