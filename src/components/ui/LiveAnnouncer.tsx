import React, { useEffect, useRef, useState } from 'react';
import { subscribeAnnouncements } from '@kernel/locale/announcer';

/**
 * The screen-reader announcement outlet (Phase 8 §D, a11y item 2):
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
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let raf = 0;
    const unsubscribe = subscribeAnnouncements((announcement) => {
      const set = announcement.assertive ? setAssertive : setPolite;
      // Clear, then write next frame so identical text re-announces.
      set('');
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        set(announcement.text);
        // Empty the region a while after announcing so stale text is not
        // re-read when a user walks the accessibility tree later.
        if (clearTimer.current) clearTimeout(clearTimer.current);
        clearTimer.current = setTimeout(() => set(''), 10_000);
      });
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
      if (clearTimer.current) clearTimeout(clearTimer.current);
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
