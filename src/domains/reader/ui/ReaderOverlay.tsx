/**
 * ReaderOverlay — the decorative/interactive contract for geometry portals
 * over the epub.js container (Phase 6 §4, contract C7).
 *
 * Geometry overlays portal into the epub.js manager container so they scroll
 * in lockstep with the text at native frame rates (the preserved
 * geometry-overlay-portal keeper). Two modes, mechanically enforced:
 *
 *  - `decorative`: hidden from the accessibility tree (`aria-hidden`) AND
 *    click-transparent (`pointer-events: none`). Pinyin conforms.
 *  - `interactive`: NEVER inside an aria-hidden container (focusable
 *    children inside aria-hidden was the app-shell a11y finding for note
 *    markers — fixed by this contract), requires an accessible `label`,
 *    container stays click-transparent so only the children (which opt into
 *    `pointer-events: auto`) take hits.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@lib/utils';

interface DecorativeOverlayProps {
  mode: 'decorative';
  label?: undefined;
}

interface InteractiveOverlayProps {
  mode: 'interactive';
  /** Accessible name for the overlay group (required for interactive overlays). */
  label: string;
}

export type ReaderOverlayProps = (DecorativeOverlayProps | InteractiveOverlayProps) & {
  /** The epub.js scrolling container to portal into. */
  containerNode: Element | null;
  /** Extra classes (e.g. z-index) merged onto the overlay root. */
  className?: string;
  children: React.ReactNode;
};

export const ReaderOverlay: React.FC<ReaderOverlayProps> = ({
  mode,
  label,
  containerNode,
  className,
  children,
}) => {
  if (!containerNode) return null;

  const content =
    mode === 'decorative' ? (
      <div
        className={cn('absolute inset-0 pointer-events-none overflow-visible', className)}
        aria-hidden="true"
      >
        {children}
      </div>
    ) : (
      <div
        className={cn('absolute inset-0 pointer-events-none overflow-visible', className)}
        role="group"
        aria-label={label}
      >
        {children}
      </div>
    );

  return createPortal(content, containerNode);
};
