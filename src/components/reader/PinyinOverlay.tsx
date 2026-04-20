import React from 'react';

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
}

/**
 * A transparent overlay that renders Pinyin annotations at specific geometry coordinates.
 * This component preserves the EPUB DOM integrity by rendering annotations in an ephemeral
 * UI layer instead of mutating the book content directly.
 */
export const PinyinOverlay: React.FC<PinyinOverlayProps> = ({ positions, pinyinSize }) => {
  if (positions.length === 0) return null;

  return (
    <div 
      className="fixed inset-0 pointer-events-none z-[40] overflow-hidden"
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
};
