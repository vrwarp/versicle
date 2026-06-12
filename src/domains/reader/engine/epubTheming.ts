/**
 * epubTheming — the reader's presentation pipeline, extracted verbatim from
 * useEpubReader (Phase 6 §5 table row "useEpubReader dissolves",
 * prep/phase6-reader-engine.md PR-4).
 *
 * Owns everything that turns preference state into iframe CSS:
 *  - base theme registration (light/dark/sepia),
 *  - the settings effect body (`applyReaderTheme`): custom theme, highlight
 *    CSS from the ONE styles registry, font scale + line-height
 *    normalization against the book's measured baseline, flow mode, forced
 *    styles injection,
 *  - the per-content-load CSS normalization hook (`injectContentExtras`):
 *    absolute→rem CSSOM rewrite, static styles, the scrolled-mode spacer.
 *
 * D5 (reader.md): `applyReaderTheme` reflows ONLY when the flow mode
 * actually changed — colors/typography-only updates no longer call
 * `flow()+display()`, so they no longer fire a relocation event per
 * settings tweak (pinned by epubTheming.test.ts; the always-reflow
 * extraction commit precedes the fix commit, per the prep doc's
 * characterization-then-improve discipline).
 */
import type { Rendition, Contents } from 'epubjs';
import { internals } from './epubjsInternals';
import { iframeHighlightThemeCss } from './highlightStyles';

/**
 * Static styles injected into every section document (e.g. note markers).
 * Currently empty — kept verbatim from the legacy hook; deleting the dead
 * constant is the PR-14 exit-audit item (prep doc Reality #6).
 */
const STATIC_READER_STYLES = `
`;

/** The ideal unified size at 100% scale. */
const TARGET_BASE_PX = 16;
/** Standard baseline leading ratio. */
const TARGET_RATIO = 1.35;

/**
 * Normalizes absolute CSS lengths to rem units based on a 16pt (1rem) standard.
 * Conversion table assumes:
 * 16pt = 1rem
 * 1px = 0.046875rem
 * 1in = 4.5rem
 * 1cm = 1.771875rem
 * 1mm = 0.1771875rem
 * 1pc = 0.75rem
 * 1Q = 0.044296875rem
 */
export const normalizeAbsoluteToRem = (cssValue: string): string | null => {
  if (!cssValue) return null;

  const namedMap: Record<string, string> = {
    'xx-small': '0.5625rem',
    'x-small': '0.625rem',
    'small': '0.8125rem',
    'medium': '1rem',
    'large': '1.125rem',
    'x-large': '1.5rem',
    'xx-large': '2rem'
  };

  const lowerValue = cssValue.toLowerCase().trim();
  if (namedMap[lowerValue]) return namedMap[lowerValue];

  const unitMap: Record<string, number> = {
    'pt': 1 / 16,
    'px': 0.046875,
    'in': 4.5,
    'cm': 1.771875,
    'mm': 0.1771875,
    'pc': 0.75,
    'q': 0.044296875
  };

  const match = lowerValue.match(/^([\d.]+)(pt|px|in|cm|mm|pc|q)$/);
  if (match) {
    const val = parseFloat(match[1]);
    const unit = match[2];
    if (!isNaN(val) && unitMap[unit]) {
      const remVal = val * unitMap[unit];
      // Round to 5 decimal places to avoid floating point anomalies like 1.5000000000000002rem
      return `${Math.round(remVal * 100000) / 100000}rem`;
    }
  }

  return null;
};

/**
 * Programmatically injects CSS into a document in a CSP-compliant way.
 * Prefers Adopted Stylesheets if supported, falling back to rule insertion.
 */
export const safeInjectStyles = (doc: Document, css: string, styleId: string) => {
  try {
    // 1. Try Adopted Stylesheets (Modern & CSP-friendly)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((doc as any).adoptedStyleSheets && typeof (window as any).CSSStyleSheet !== 'undefined') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sheets = [...((doc as any).adoptedStyleSheets || [])];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existingIndex = sheets.findIndex((s: any) => s._versicle_id === styleId);

        if (existingIndex !== -1) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (sheets[existingIndex] as any).replaceSync(css);
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const newSheet = new (window as any).CSSStyleSheet();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newSheet as any)._versicle_id = styleId;
        newSheet.replaceSync(css);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (doc as any).adoptedStyleSheets = [...sheets, newSheet];
        return;
      } catch {
        // Fallback to legacy injection
      }
    }

    // 2. Programmatic Rule Insertion (Bypasses most inline-style CSP filters)
    let style = doc.getElementById(styleId) as HTMLStyleElement;
    if (!style) {
      style = doc.createElement('style');
      style.id = styleId;
      doc.head.appendChild(style);
    }

    const sheet = style.sheet;
    if (sheet) {
      // Clear rules
      while (sheet.cssRules.length > 0) {
        sheet.deleteRule(0);
      }
      // Split into individual blocks
      const rules = css.split(/}\s*/).filter(r => r.trim()).map(r => r + '}');
      for (const rule of rules) {
        try {
          sheet.insertRule(rule, sheet.cssRules.length);
        } catch {
          // Skip rules that fail parsing in this browser
        }
      }
      return;
    }

    // 3. Desperate Fallback (Likely to fail CSP but works in legacy non-CSP envs)
    style.textContent = css;
  } catch {
    // Execution failure
  }
};

/** Registers the built-in light/dark/sepia themes (verbatim). */
export function registerBaseThemes(rendition: Rendition): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const themes = rendition.themes as any;
  themes.register('light', {
    'body': { 'background': '#ffffff !important', 'color': '#000000 !important' },
    'p, div, span, h1, h2, h3, h4, h5, h6': { 'color': 'inherit !important', 'background': 'transparent !important' },
    'a': { 'color': '#0000ee !important' }
  });
  themes.register('dark', {
    'body': { 'background': '#1a1a1a !important', 'color': '#f5f5f5 !important' },
    'p, div, span, h1, h2, h3, h4, h5, h6': { 'color': 'inherit !important', 'background': 'transparent !important' },
    'a': { 'color': '#6ab0f3 !important' }
  });
  themes.register('sepia', {
    'body': { 'background': '#f4ecd8 !important', 'color': '#5b4636 !important' },
    'p, div, span, h1, h2, h3, h4, h5, h6': { 'color': 'inherit !important', 'background': 'transparent !important' },
    'a': { 'color': '#0000ee !important' }
  });
}

/**
 * Read-time fontFamily normalization (Phase 8 §I, RC-16): the pinyin font
 * was renamed off the OFL Reserved Font Names ('PT Sans Narrow' →
 * 'Versicle Sans Narrow'). The synced `fontFamily` preference is free-form
 * but no shipped UI ever wrote the legacy family (VisualSettings only
 * offers serif/sans-serif/monospace), so this is deliberate
 * belt-and-braces with NO persisted migration — the rule-4 ledger slot
 * stays released (zero P8 user-data format changes). Applied at the two
 * consumption points below; idempotent.
 */
export function normalizeFontFamily(fontFamily: string): string {
  return fontFamily.replace(/PT Sans Narrow/g, 'Versicle Sans Narrow');
}

/** The full presentation input (the prep doc's `ReaderThemeSpec`). */
export interface ReaderThemeSpec {
  viewMode: 'paginated' | 'scrolled';
  currentTheme: string;
  customTheme: { bg: string; fg: string };
  fontFamily: string;
  /** Font size percentage (user preference, pre-normalization). */
  fontSize: number;
  lineHeight: number;
  shouldForceFont: boolean;
  /** Pinyin minimum-leading flag (line-height floor 1.8). */
  showPinyin: boolean;
  /** Book-measured baseline font size in px (normalization input). */
  baseFontSize?: number;
  /** Book-measured baseline line height in px (normalization input). */
  baseLineHeight?: number;
}

/**
 * The font-scale + line-height normalization math (verbatim from the legacy
 * settings effect) — exported for the characterization unit suite.
 */
export function computeFontScale(spec: ReaderThemeSpec): {
  finalFSScalePct: number;
  finalLH: number;
} {
  // Fallback to TARGET_BASE_PX if metadata is missing, resulting in a 1.0 multiplier
  const bookBasePx = spec.baseFontSize || TARGET_BASE_PX;
  // Calculate book's native ratio (resolved px LH / resolved px FS)
  const bookBaseLH = spec.baseLineHeight || (bookBasePx * TARGET_RATIO);
  const bookNativeRatio = bookBaseLH / bookBasePx;

  // Normalization factors
  const fsNormalizationFactor = TARGET_BASE_PX / bookBasePx;
  const lhNormalizationFactor = TARGET_RATIO / bookNativeRatio;
  const finalFSScalePct = Math.round(spec.fontSize * fsNormalizationFactor);

  // Apply line height normalization
  const normalizedLH = spec.lineHeight * lhNormalizationFactor;
  // Respect Pinyin minimum leading even after normalization
  const finalLH = spec.showPinyin ? Math.max(normalizedLH, 1.8) : normalizedLH;

  return { finalFSScalePct, finalLH };
}

/**
 * Builds the forced-styles CSS block (font scaling always; color/font
 * mapping when forced or in non-light themes) — verbatim, exported for the
 * characterization unit suite.
 */
export function buildForcedStylesCss(spec: ReaderThemeSpec, finalFSScalePct: number): string {
  const isDarkOrSepia = spec.currentTheme === 'dark' || spec.currentTheme === 'sepia' || spec.currentTheme === 'custom';

  // The scaling part MUST always apply for normalization to work
  let css = `
            html {
              font-size: ${finalFSScalePct}% !important;
            }
          `;

  // Only add the "Force Font" and "Theme Colors" mapping if requested or in non-light themes
  if (spec.shouldForceFont || isDarkOrSepia) {
    let bg, fg, linkColor;
    switch (spec.currentTheme) {
      case 'dark':
        bg = '#1a1a1a'; fg = '#f5f5f5'; linkColor = '#6ab0f3';
        break;
      case 'sepia':
        bg = '#f4ecd8'; fg = '#5b4636'; linkColor = '#0000ee';
        break;
      case 'custom':
        bg = spec.customTheme?.bg || '#ffffff'; fg = spec.customTheme?.fg || '#000000'; linkColor = spec.customTheme?.fg || '#000000';
        break;
      default: // light + forced font
        bg = '#ffffff'; fg = '#000000'; linkColor = '#0000ee';
    }

    const fontCss = spec.shouldForceFont ? `
                font-family: ${normalizeFontFamily(spec.fontFamily)} !important;
                line-height: ${spec.lineHeight} !important;
                text-align: left !important;
            ` : '';

    css += `
              html body *, html body p, html body div, html body span, html body h1, html body h2, html body h3, html body h4, html body h5, html body h6 {
                ${fontCss}
                color: ${fg} !important;
                background-color: transparent !important;
                -webkit-touch-callout: none !important;
              }
              html, body {
                background: ${bg} !important;
              }
              a, a * {
                color: ${linkColor} !important;
                text-decoration: none !important;
              }
              a:hover, a:hover * {
                text-decoration: underline !important;
              }
            `;
  }

  return css;
}

/**
 * Applies the whole presentation spec to a live rendition — the legacy
 * settings-effect body, verbatim except D5: `flow()` (plus the
 * location-restoring `display()`) runs ONLY when the flow mode actually
 * changed, passed in by the caller who tracks the previous mode. Returns
 * the forced-styles applier so the content hook can re-run it on section
 * load (the legacy `applyStylesRef` contract).
 */
export function applyReaderTheme(
  rendition: Rendition,
  spec: ReaderThemeSpec,
  opts: { flowModeChanged: boolean },
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const themes = rendition.themes as any;

  themes.register('custom', {
    'body': { 'background': `${spec.customTheme?.bg || '#ffffff'} !important`, 'color': `${spec.customTheme?.fg || '#000000'} !important` },
    'p, div, span, h1, h2, h3, h4, h5, h6': { 'color': 'inherit !important', 'background': 'transparent !important' },
    // PR-14 typo audit: the fallback was the invalid hex '#0000e' (the
    // browser dropped the declaration); fixed to the built-in link blue.
    'a': { 'color': `${spec.customTheme?.fg || '#0000ee'} !important` }
  });

  // Highlight theme rules from the ONE styles registry (Phase 6 §4).
  themes.default(iframeHighlightThemeCss(spec.currentTheme));

  themes.select(spec.currentTheme);

  // Set the theme font options.
  themes.fontSize(`${spec.fontSize}%`);
  themes.font(normalizeFontFamily(spec.fontFamily));

  const { finalFSScalePct, finalLH } = computeFontScale(spec);

  themes.default({
    p: {
      'line-height': `${finalLH} !important`,
    },
    body: {
      'line-height': `${finalLH} !important`
    }
  });

  // Flow — D5: only when the mode actually changed (a colors/typography
  // update must not reflow + re-display, which fired a spurious relocation
  // per settings tweak in the legacy effect).
  if (opts.flowModeChanged) {
    // Capture current location before changing flow to prevent reset
    const currentLoc = (rendition.location as typeof rendition.location | undefined)?.start?.cfi;

    rendition.flow(spec.viewMode === 'scrolled' ? 'scrolled-doc' : 'paginated');

    // Restore location if available
    if (currentLoc) {
      rendition.display(currentLoc);
    }
  }

  // Forced Styles
  const applyStyles = () => {
    const css = buildForcedStylesCss(spec, finalFSScalePct);

    // Apply to all active contents
    internals(rendition).getContents().forEach((content) => {
      const doc = content.document;
      if (doc) {
        safeInjectStyles(doc, css, 'force-theme-style');
      }
    });
  };

  applyStyles();
  return applyStyles;
}

/**
 * Per-content-load CSS normalization (the legacy `injectExtras` hook,
 * verbatim): absolute→rem rewrite of stylesheet + inline styles, forced
 * styles re-application, static styles, and the scrolled-mode spacer.
 */
export function injectContentExtras(
  contents: Contents,
  opts: {
    viewMode: 'paginated' | 'scrolled';
    /** Re-applies the forced styles (the value applyReaderTheme returned). */
    reapplyForcedStyles: () => void;
  },
): void {
  const doc = contents.document;
  if (!doc) return;

  // Normalize CSS OM to map absolute units to relative REM based on 16pt=1rem baseline
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processRule = (rule: any) => {
      if (rule && rule.style) {
        if (rule.style.fontSize) {
          const newFontSize = normalizeAbsoluteToRem(rule.style.fontSize);
          if (newFontSize) rule.style.fontSize = newFontSize;
        }
        if (rule.style.lineHeight) {
          const newLineHeight = normalizeAbsoluteToRem(rule.style.lineHeight);
          if (newLineHeight) rule.style.lineHeight = newLineHeight;
        }
      }
      if (rule && rule.cssRules) {
        for (let i = 0; i < rule.cssRules.length; i++) {
          processRule(rule.cssRules[i]);
        }
      }
    };

    for (let i = 0; i < doc.styleSheets.length; i++) {
      const sheet = doc.styleSheets[i];
      // Skip dynamic injected themes
      if (sheet.ownerNode && 'id' in sheet.ownerNode && ((sheet.ownerNode as Element).id === 'force-theme-style' || (sheet.ownerNode as Element).id === 'reader-static-styles')) continue;

      try {
        for (let j = 0; j < sheet.cssRules.length; j++) {
          processRule(sheet.cssRules[j]);
        }
      } catch {
        // Ignore CORS errors on cross-origin stylesheets if they happen
      }
    }
  } catch {
    // General catch
  }

  // Normalize inline styles
  try {
    const styledElements = doc.querySelectorAll('[style]');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    styledElements.forEach((el: any) => {
      if (el.style.fontSize) {
        const newFontSize = normalizeAbsoluteToRem(el.style.fontSize);
        if (newFontSize) el.style.fontSize = newFontSize;
      }
      if (el.style.lineHeight) {
        const newLineHeight = normalizeAbsoluteToRem(el.style.lineHeight);
        if (newLineHeight) el.style.lineHeight = newLineHeight;
      }
    });
  } catch {
    // Ignore query conflicts
  }

  // Re-apply forced styles on content load
  opts.reapplyForcedStyles();

  // Inject static styles (e.g. note markers)
  safeInjectStyles(doc, STATIC_READER_STYLES, 'reader-static-styles');

  // Inject empty div for scrolling space
  const spacerId = 'reader-bottom-spacer';
  if (opts.viewMode === 'scrolled' && !doc.getElementById(spacerId)) {
    const spacer = doc.createElement('div');
    spacer.id = spacerId;
    spacer.style.height = '150px';
    spacer.style.width = '100%';
    spacer.style.clear = 'both'; // Ensure it sits below floated content
    doc.body.appendChild(spacer);
  }
}
