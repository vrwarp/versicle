import React from 'react';
import { parentHighlightCss } from '@domains/reader/engine/highlightStyles';

interface ReaderHighlightsStylesProps {
    currentTheme: string;
}

/**
 * Parent-document styling for the epub.js SVG highlight layers. The CSS
 * itself comes from the ONE highlight styles registry (Phase 6 §4,
 * src/domains/reader/engine/highlightStyles.ts) — these rules are the ones
 * that actually win for SVG `fill`/`fill-opacity`/`mix-blend-mode`, since
 * epub.js draws annotation SVGs in the parent document.
 */
export const ReaderHighlightsStyles: React.FC<ReaderHighlightsStylesProps> = ({ currentTheme }) => {
    return (
        <>
            {/* Striped highlight pattern */}
            <svg
                xmlns="http://www.w3.org/2000/svg"
                id="epubjs-custom-defs"
                style={{ width: 0, height: 0, position: 'absolute' }}
                aria-hidden="true"
            >
                <defs>
                    <pattern
                        id="striped-highlight"
                        patternUnits="userSpaceOnUse"
                        width="16"
                        height="10"
                        patternTransform="rotate(45)"
                    >
                        <rect width="8" height="10" fill="orange" />
                    </pattern>
                </defs>
            </svg>

            {/* Highlights CSS styles (single registry source) */}
            <style>{parentHighlightCss(currentTheme)}</style>
        </>
    );
};
