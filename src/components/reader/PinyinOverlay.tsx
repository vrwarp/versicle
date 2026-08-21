import React, { useMemo } from 'react';
import { useSyncExternalStore } from 'react';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useVocabularyStore } from '@store/useVocabularyStore';
import { ReaderOverlay } from '@domains/reader/ui/ReaderOverlay';
import { canonicalizeChar } from '@domains/chinese/vocabulary/canonicalize';
import type { PinyinPosition, PinyinPositionsSource } from '@domains/chinese/types';

/**
 * Pinyin position entry — canonical definition lives with the chinese
 * feature module (Phase 6 §7 types.ts); re-exported here for the legacy
 * import path.
 */
export type { PinyinPosition };

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
 *
 * Render cost posture (a chapter carries THOUSANDS of these spans):
 *  - the span list is memoized on [positions, knownCharacters] — unrelated
 *    parent renders reuse the exact same elements (React bails);
 *  - the theme-dependent halo color AND the user's pinyin size are CSS
 *    custom properties on the overlay ROOT (`--pinyin-halo`,
 *    `--pinyin-scale`), so a theme or size change restyles one node —
 *    the browser recomputes the spans' styles without React reconciling
 *    thousands of elements;
 *  - the component itself is memoized: a re-render of the shell with equal
 *    props does not re-reconcile the span forest.
 */
export const PinyinOverlay: React.FC<PinyinOverlayProps> = React.memo(({
  positions,
  pinyinSize,
  containerNode
}) => {
  const currentTheme = usePreferencesStore(state => state.currentTheme) || 'light';
  const customThemeBg = usePreferencesStore(state => state.customTheme?.bg) || '#ffffff';
  const knownCharacters = useVocabularyStore(state => state.knownCharacters);

  // Known-character suppression compares the CANONICAL (simplified)
  // form of the DISPLAYED char (CH-6 read path, CRDT v7): suppression
  // works identically in Simplified and Traditional display modes.
  const spans = useMemo(() => {
    return positions
      .filter(pos => !knownCharacters[canonicalizeChar(pos.char)])
      .map((pos, idx) => (
        <span
          key={`${pos.char}-${idx}`}
          className="absolute text-muted-foreground whitespace-nowrap font-pinyin"
          style={{
            top: pos.top - 2, // Position just above the character
            left: pos.left,
            transform: 'translate(-50%, -100%)',
            // Size + halo ride the overlay root's custom properties so these
            // style strings never change per preference — a size/theme tweak
            // restyles the root instead of re-rendering every span.
            fontSize: 'calc(0.7rem * var(--pinyin-scale, 1))',
            lineHeight: 1,
            textShadow: '0 0 2px var(--pinyin-halo), 0 0 4px var(--pinyin-halo)',
            display: 'block',
            textAlign: 'center',
            minWidth: '1em'
          }}
        >
          {pos.pinyin}
        </span>
      ));
  }, [positions, knownCharacters]);

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
    shadowColor = customThemeBg;
  }

  return (
    <ReaderOverlay
      mode="decorative"
      containerNode={containerNode}
      className="z-[10]"
      style={{
        '--pinyin-halo': shadowColor,
        '--pinyin-scale': pinyinSize / 100,
      } as React.CSSProperties}
    >
      {spans}
    </ReaderOverlay>
  );
});
PinyinOverlay.displayName = 'PinyinOverlay';

interface PinyinOverlayHostProps {
  /** The controller's positions feed (geometry updates bypass React state). */
  source: PinyinPositionsSource;
  pinyinSize: number;
  containerNode: Element | null;
}

/**
 * Subscribes to the controller's positions source and renders the overlay.
 * The subscription lives HERE (useSyncExternalStore) so a geometry emission
 * re-renders only this subtree — the reader shell and its other children
 * never see position churn.
 */
export const PinyinOverlayHost: React.FC<PinyinOverlayHostProps> = ({
  source,
  pinyinSize,
  containerNode,
}) => {
  const positions = useSyncExternalStore(source.subscribe, source.getSnapshot);
  return (
    <PinyinOverlay positions={positions} pinyinSize={pinyinSize} containerNode={containerNode} />
  );
};
