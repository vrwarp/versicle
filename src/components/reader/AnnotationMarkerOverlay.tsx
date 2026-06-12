import React from 'react';
import { ReaderOverlay } from '@domains/reader/ui/ReaderOverlay';

export interface MarkerPosition {
  id: string;
  cfi: string;
  top: number;
  left: number;
  note: string;
  text: string;
}

interface AnnotationMarkerOverlayProps {
  markers: MarkerPosition[];
  /** Callback when a marker is clicked */
  onMarkerClick: (x: number, y: number, cfi: string, text: string, id: string) => void;
  /** The epub.js scrolling container to portal into */
  containerNode: Element | null;
}

/**
 * A transparent overlay that renders annotation note markers at specific geometry coordinates.
 * This component preserves the EPUB DOM integrity by rendering interactive elements in an ephemeral
 * UI layer inside the EPUB's native scroll container.
 */
export const AnnotationMarkerOverlay: React.FC<AnnotationMarkerOverlayProps> = ({
  markers,
  onMarkerClick,
  containerNode
}) => {
  if (markers.length === 0 || !containerNode) return null;

  // ReaderOverlay 'interactive' contract (Phase 6 §4): focusable marker
  // buttons must NOT live inside an aria-hidden container (the app-shell
  // a11y finding) — the overlay group carries an accessible name instead.
  return (
    <ReaderOverlay mode="interactive" label="Annotation notes" containerNode={containerNode} className="z-10">
      {markers.map(marker => (
        <button
          key={marker.id}
          type="button"
          data-testid="note-marker"
          className="note-marker absolute w-4 h-4 bg-yellow-300 border border-yellow-500 rounded-sm pointer-events-auto cursor-pointer shadow-sm hover:scale-110 hover:shadow-md transition-all duration-200 mix-blend-multiply before:content-[''] before:absolute before:-inset-3"
          style={{
            top: marker.top,
            left: marker.left - 4, // 4px negative offset from the end of text
            transform: 'translateY(-75%)' // Center vertically relative to the top of the line
          }}
          onClick={(e) => {
            e.stopPropagation();
            // Show popover slightly below the marker
            onMarkerClick(marker.left, marker.top + 20, marker.cfi, marker.text, marker.id);
          }}
          title={marker.note}
          aria-label={`Note: ${marker.note}`}
        >
          {/* Subtle icon lines similar to the old CSS ::after */}
          <div className="absolute inset-x-[3px] top-[3px] h-[1px] bg-yellow-600 shadow-[0_3px_0_theme(colors.yellow.600),0_6px_0_theme(colors.yellow.600)]" />
        </button>
      ))}
    </ReaderOverlay>
  );
};
