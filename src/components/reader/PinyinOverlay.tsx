import React from 'react';
import { createPortal } from 'react-dom';

/**
 * Pinyin position entry.
 */
export interface PinyinPosition {
  char: string;
  pinyin: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

interface PinyinOverlayProps {
  positions: PinyinPosition[];
  pinyinSize: number;
  /** The epub.js scrolling container to portal into */
  containerNode: Element | null;
}

/**
 * A transparent overlay that renders Pinyin annotations at specific geometry coordinates.
 * This component preserves the EPUB DOM integrity by rendering annotations in an ephemeral
 * UI layer inside the EPUB's native scroll container. This ensures that Pinyin scrolls
 * in lockstep with the text at native frame rates.
 */
export const PinyinOverlay: React.FC<PinyinOverlayProps> = ({ 
  positions, 
  pinyinSize,
  containerNode 
}) => {
  if (positions.length === 0 || !containerNode) return null;

  const overlayContent = (
    <div 
      className="absolute inset-0 pointer-events-none z-[10] overflow-visible"
      aria-hidden="true"
    >
      {positions.map((pos, idx) => (
        <span
          key={`${pos.char}-${idx}`}
          className="absolute text-muted-foreground whitespace-nowrap transition-opacity duration-200"
          style={{
            top: pos.top - 2, // Position just above the character
            left: pos.left,
            transform: 'translate(-50%, -100%)',
            fontSize: `${0.7 * (pinyinSize / 100)}rem`,
            lineHeight: 1,
            textShadow: '0 0 2px white, 0 0 4px white', // Ensure readability over any background
            display: 'block',
            textAlign: 'center',
            minWidth: '1em'
          }}
        >
          {pos.pinyin}
        </span>
      ))}
    </div>
  );

  return createPortal(overlayContent, containerNode);
};
