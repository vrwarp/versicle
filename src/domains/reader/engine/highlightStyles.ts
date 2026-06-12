/**
 * highlightStyles — the ONE registry for reader highlight rendering
 * (Phase 6 §4, prep/phase6-reader-engine.md).
 *
 * Before this module, highlight styling came from THREE conflicting sources:
 *   1. iframe `themes.default` CSS (useEpubReader: fill-opacity 0.3/0.4) —
 *      mostly DEAD for SVG highlights: epub.js draws annotation SVGs in the
 *      PARENT document (marks-pane over the iframe), where iframe CSS cannot
 *      reach. Only the `background-color` rules could ever match in-iframe
 *      elements, and no highlight class is used inside the iframe.
 *   2. parent-document CSS (ReaderHighlightsStyles.tsx): .highlight-* +
 *      .versicle-audio-bookmark-pending — these WIN over epub.js's SVG
 *      presentation attributes (CSS rules beat presentation attributes).
 *   3. per-call `styles` objects (history/debug) — applied by epub.js via
 *      `setAttribute`, merged over its defaults {fill: yellow,
 *      fill-opacity: 0.3, mix-blend-mode: multiply}. CamelCase keys
 *      (fillOpacity/mixBlendMode/backgroundColor) are NOT valid SVG
 *      presentation attributes and have never rendered — they are pinned
 *      here byte-identical anyway so consolidation cannot move a pixel.
 *
 * EFFECTIVE rendering pinned by this registry (the characterization
 * baseline; verified against epubjs/src/managers/views/iframe.js:606-624 +
 * marks-pane/src/marks.js:129-137):
 *   - annotation colors: class fill (#fde047/#86efac/#93c5fd/#fca5a5),
 *     fill-opacity 0.8 light / 0.4 dark, multiply/screen (parent CSS wins).
 *   - audio-bookmark pending: striped pattern fill, same opacity/blend.
 *   - tts: epub.js attribute defaults — yellow, 0.3, multiply (no CSS).
 *   - history: gray fill attribute over the 0.3/multiply defaults (the
 *     intended fillOpacity 0.1 never applied — dead camelCase key).
 *   - debug: rgba(255,165,0,0.3) fill attribute over 0.3/multiply defaults
 *     (intended fillOpacity 1 / dark-theme screen never applied).
 */

/**
 * Reserved layer ids for the HighlightLayerManager. 'search' is reserved for
 * the Phase 7 SearchSession (navigate-to-match temporary highlight).
 */
export type HighlightLayerId = 'annotation' | 'tts' | 'history' | 'debug' | 'search';

export interface HighlightLayerConfig {
  /** Default epub.js class when the caller does not name one. */
  defaultClassName: string;
  /**
   * Default `styles` object handed to `annotations.add` (epub.js applies it
   * as SVG attributes). `undefined` means the 5-arg call form — byte-
   * compatible with the pre-manager call sites.
   */
  defaultStyles?: Record<string, string>;
  /**
   * Whether add/remove on this layer runs the orphaned-SVG DOM sweep.
   * epub.js occasionally orphans nested SVG annotations if inject() runs
   * multiple times or visibility races occur — scar tissue inherited from
   * ReaderTTSController (provenance comment there). Only 'tts' today.
   */
  sweepOrphans: boolean;
  /** Class swept by the orphan sweep (only meaningful when sweepOrphans). */
  sweepClassName?: string;
}

export const HIGHLIGHT_LAYERS: Record<HighlightLayerId, HighlightLayerConfig> = {
  annotation: {
    defaultClassName: 'highlight-yellow',
    sweepOrphans: false,
  },
  tts: {
    defaultClassName: 'tts-highlight',
    sweepOrphans: true,
    sweepClassName: 'tts-highlight',
  },
  history: {
    defaultClassName: 'reading-history-highlight',
    // Verbatim from useHistoryHighlights.ts:84 (incl. the dead camelCase
    // keys — see module docs; effective: gray @ 0.3 multiply).
    defaultStyles: { fill: 'gray', fillOpacity: '0.1', mixBlendMode: 'multiply' },
    sweepOrphans: false,
  },
  debug: {
    defaultClassName: 'debug-analysis-highlight',
    sweepOrphans: false,
  },
  search: {
    defaultClassName: 'search-highlight',
    sweepOrphans: false,
  },
};

/** User-annotation color → epub.js class mapping (ReaderView diff effect, verbatim). */
export function annotationClassName(color: string | undefined): string {
  switch (color) {
    case 'yellow':
      return 'highlight-yellow';
    case 'green':
      return 'highlight-green';
    case 'blue':
      return 'highlight-blue';
    case 'red':
      return 'highlight-red';
    default:
      return 'highlight-yellow';
  }
}

/** The pending audio-bookmark striped class (CompassPill triage flow). */
export const AUDIO_BOOKMARK_PENDING_CLASS = 'versicle-audio-bookmark-pending';

/** Annotation SVG fill colors (single source for parent CSS + iframe theme). */
const ANNOTATION_FILLS: Record<string, string> = {
  'highlight-yellow': '#fde047',
  'highlight-green': '#86efac',
  'highlight-blue': '#93c5fd',
  'highlight-red': '#fca5a5',
};

/** TTS sentence-highlight fill (iframe theme intent; SVG renders epub.js yellow). */
const TTS_FILL = '#fde047';

/**
 * Parent-document CSS for the epub.js SVG highlight layers — the rules that
 * actually WIN for `fill`/`fill-opacity`/`mix-blend-mode`. Pinned values:
 * opacity 0.8 light / 0.4 dark, multiply/screen (ReaderHighlightsStyles.tsx
 * verbatim).
 */
export function parentHighlightCss(currentTheme: string): string {
  const isDark = currentTheme === 'dark';
  const opacity = isDark ? 0.4 : 0.8;
  const blendMode = isDark ? 'screen' : 'multiply';

  const classRules = Object.entries(ANNOTATION_FILLS)
    .map(
      ([cls, fill]) => `
                .${cls} {
                    fill: ${fill};
                    fill-opacity: ${opacity};
                    mix-blend-mode: ${blendMode};
                }`,
    )
    .join('');

  return `${classRules}
                .${AUDIO_BOOKMARK_PENDING_CLASS} {
                    fill: url(#striped-highlight);
                    fill-opacity: ${opacity};
                    mix-blend-mode: ${blendMode};
                }
            `;
}

/**
 * Iframe theme rules for the highlight classes (useEpubReader.ts:861-872
 * verbatim — the `themes.default` payload). Kept emitting exactly the same
 * object so the iframe stylesheet is unchanged; see module docs for why most
 * of this never reaches the SVG layer.
 */
export function iframeHighlightThemeCss(currentTheme: string): Record<string, Record<string, string>> {
  const isDark = currentTheme === 'dark';
  const highlightBlendMode = isDark ? 'screen' : 'multiply';
  const highlightOpacity = String(isDark ? 0.4 : 0.3);

  const rule = (fill: string, rgb: string): Record<string, string> => ({
    fill,
    'background-color': isDark ? `rgba(${rgb}, 0.4)` : `rgba(${rgb}, 0.3)`,
    'fill-opacity': highlightOpacity,
    'mix-blend-mode': highlightBlendMode,
  });

  return {
    '.tts-highlight': rule(TTS_FILL, '253, 224, 71'),
    '.highlight-yellow': rule('#fde047', '253, 224, 71'),
    '.highlight-green': rule('#86efac', '134, 239, 172'),
    '.highlight-blue': rule('#93c5fd', '147, 197, 253'),
    '.highlight-red': rule('#fca5a5', '252, 165, 165'),
  };
}
