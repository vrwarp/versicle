import React from 'react';
import { createPortal } from 'react-dom';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { useVocabularyStore } from '../../store/useVocabularyStore';

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
  const currentTheme = usePreferencesStore(state => state.currentTheme) || 'light';
  const customTheme = usePreferencesStore(state => state.customTheme) || { bg: '#ffffff' };
  const knownCharacters = useVocabularyStore(state => state.knownCharacters);

  if (positions.length === 0 || !containerNode) return null;

  // Compute shadow color to ensure crisp contrast on all reading backgrounds
  // - Light theme uses pure white shadow (body bg is #ffffff)
  // - Sepia theme uses warm sepia shadow (body bg is #f4ecd8)
  // - Dark theme uses deep dark gray shadow (body bg is #1a1a1a) to avoid the wonky halo glow
  let shadowColor = '#ffffff';
  const themeStr = currentTheme as string;
  if (themeStr === 'dark') {
    shadowColor = '#1a1a1a';
  } else if (themeStr === 'sepia') {
    shadowColor = '#f4ecd8';
  } else if (themeStr === 'custom') {
    shadowColor = customTheme.bg || '#ffffff';
  }

  const overlayContent = (
    <div 
      className="absolute inset-0 pointer-events-none z-[10] overflow-visible"
      aria-hidden="true"
    >
      {positions.filter(pos => !knownCharacters[pos.char]).map((pos, idx) => (
        <span
          key={`${pos.char}-${idx}`}
          className="absolute text-muted-foreground whitespace-nowrap transition-opacity duration-200 font-pinyin"
          style={{
            top: pos.top - 2, // Position just above the character
            left: pos.left,
            transform: 'translate(-50%, -100%)',
            fontSize: `${0.7 * (pinyinSize / 100)}rem`,
            lineHeight: 1,
            textShadow: `0 0 2px ${shadowColor}, 0 0 4px ${shadowColor}`, // Ensure readability over any background
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

