/**
 * Screen-reader announcement channel (Phase 8 §D, a11y item 2/10).
 *
 * Plain TS pub/sub — no React, no DOM — so stores, services and the TTS
 * adapter can `announce()` from anywhere. The ONE subscriber that matters
 * is `src/components/ui/LiveAnnouncer.tsx`, which renders two persistent
 * visually-hidden live regions (polite/assertive) in RootLayout and
 * injects announcement text into them.
 *
 * Content is keyed per the i18n ADR ({@link MessageInput}); free-form
 * prose is accepted for transitional call sites, mirroring the toast
 * queue's deprecated overload.
 */
import { resolveMessage, type MessageInput } from './messages';

interface Announcement {
  /** Monotonic id — lets the live region re-announce identical text. */
  id: number;
  /** Resolved display text. */
  text: string;
  /** true → assertive region (interrupts), false → polite. */
  assertive: boolean;
}

type AnnouncementListener = (announcement: Announcement) => void;

const listeners = new Set<AnnouncementListener>();
let nextId = 1;

/**
 * Announce a message to assistive technology. No-op (by design) when no
 * LiveAnnouncer is mounted — announcements are fire-and-forget.
 */
export function announce(
  content: MessageInput | string,
  opts: { assertive?: boolean } = {},
): void {
  const announcement: Announcement = {
    id: nextId++,
    text: resolveMessage(content),
    assertive: !!opts.assertive,
  };
  for (const listener of listeners) listener(announcement);
}

/** Subscribe to announcements. Returns the unsubscribe function. */
export function subscribeAnnouncements(listener: AnnouncementListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
