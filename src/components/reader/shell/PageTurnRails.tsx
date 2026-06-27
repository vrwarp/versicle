/**
 * PageTurnRails — the paginated-mode page-turn affordance (compass-pill
 * rework Phase 1). Full-height tap targets at the left/right edges of the
 * reading column that let the compass pill stop moonlighting as a page-turner.
 *
 * Why this exists: in paginated mode there was no swipe and no tap-zone (the
 * touch handlers in useReaderNavigation are scrolled-mode only), so the pill's
 * tiny corner arrows were the ONLY way to turn a page on a touchscreen. Those
 * arrows then had to flip meaning (page vs section) with TTS state — the
 * confusion this rework removes. The rails give page-turning its own large,
 * always-present, reachable home so the pill can become a pure audio transport.
 *
 * Rendered in the PARENT document (not the epub.js iframe), so it never
 * wrestles with iframe event capture, text selection, or RTL coordinate
 * mapping: only the outer edge strips turn pages; the central reading area
 * keeps native selection and link taps untouched.
 */
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@lib/utils';

export interface PageTurnRailsProps {
  onPrev: () => void;
  onNext: () => void;
  /** Reading direction; in RTL the leading ("next page") edge is on the LEFT. */
  direction?: 'ltr' | 'rtl';
}

const RAIL_CLASS =
  'absolute top-0 z-20 flex items-center justify-center w-10 sm:w-14 ' +
  'text-muted-foreground/40 hover:text-primary hover:bg-primary/5 active:bg-primary/10 ' +
  'transition-colors touch-manipulation focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-ring focus-visible:ring-inset';

// Match the paginated viewer height (calc(100% - 100px), see ReaderViewport) so
// the rails never overlap the bottom control bar / compass pill.
const RAIL_STYLE: React.CSSProperties = { height: 'calc(100% - 100px)' };

export const PageTurnRails: React.FC<PageTurnRailsProps> = ({ onPrev, onNext, direction = 'ltr' }) => {
  const isRtl = direction === 'rtl';

  // The physical-left control turns to the previous page in LTR and the next
  // page in RTL (page progression mirrors); the chevron mirrors with it.
  const leftLabel = isRtl ? 'Next page' : 'Previous page';
  const rightLabel = isRtl ? 'Previous page' : 'Next page';
  const onLeft = isRtl ? onNext : onPrev;
  const onRight = isRtl ? onPrev : onNext;

  // Isolate the page turn: stop the reader-view global click handler (which
  // clears popovers / compass state) from also firing — the pill's own buttons
  // isolate their clicks the same way.
  const handle = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <>
      <button
        type="button"
        data-testid="page-turn-rail-left"
        aria-label={leftLabel}
        onClick={handle(onLeft)}
        style={RAIL_STYLE}
        className={cn(RAIL_CLASS, 'left-0')}
      >
        <ChevronLeft className="w-6 h-6" aria-hidden="true" />
      </button>
      <button
        type="button"
        data-testid="page-turn-rail-right"
        aria-label={rightLabel}
        onClick={handle(onRight)}
        style={RAIL_STYLE}
        className={cn(RAIL_CLASS, 'right-0')}
      >
        <ChevronRight className="w-6 h-6" aria-hidden="true" />
      </button>
    </>
  );
};
