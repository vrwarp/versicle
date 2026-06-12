/**
 * epubTheming characterization (Phase 6 §Test plan "Vitest
 * characterization: normalizeAbsoluteToRem + font-scale math — pins the
 * epubTheming extraction", prep/phase6-reader-engine.md PR-4).
 *
 * The expected values are the legacy useEpubReader effect's arithmetic,
 * captured before the extraction: 16pt = 1rem conversion table, named-size
 * map, TARGET_BASE_PX=16 / TARGET_RATIO=1.35 normalization, the pinyin
 * 1.8 line-height floor, and the forced-styles CSS gate (force-font OR
 * non-light theme). The reflow test pins D5: flow()/display() fire only
 * when the caller reports a mode change.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Rendition } from 'epubjs';
import {
  normalizeAbsoluteToRem,
  computeFontScale,
  buildForcedStylesCss,
  applyReaderTheme,
  type ReaderThemeSpec,
} from './epubTheming';

const baseSpec: ReaderThemeSpec = {
  viewMode: 'paginated',
  currentTheme: 'light',
  customTheme: { bg: '#ffffff', fg: '#000000' },
  fontFamily: 'serif',
  fontSize: 100,
  lineHeight: 1.5,
  shouldForceFont: false,
  showPinyin: false,
};

describe('normalizeAbsoluteToRem (legacy conversion table)', () => {
  it('converts absolute units on the 16pt = 1rem standard', () => {
    expect(normalizeAbsoluteToRem('16pt')).toBe('1rem');
    expect(normalizeAbsoluteToRem('8pt')).toBe('0.5rem');
    expect(normalizeAbsoluteToRem('16px')).toBe('0.75rem');
    expect(normalizeAbsoluteToRem('1in')).toBe('4.5rem');
    expect(normalizeAbsoluteToRem('1cm')).toBe('1.77188rem'); // 1.771875 rounded to 5 places
    expect(normalizeAbsoluteToRem('1mm')).toBe('0.17719rem'); // 0.1771875 rounded to 5 places
    expect(normalizeAbsoluteToRem('1pc')).toBe('0.75rem');
    expect(normalizeAbsoluteToRem('1q')).toBe('0.0443rem');
  });

  it('maps named sizes', () => {
    expect(normalizeAbsoluteToRem('medium')).toBe('1rem');
    expect(normalizeAbsoluteToRem('XX-Large')).toBe('2rem');
    expect(normalizeAbsoluteToRem('small')).toBe('0.8125rem');
  });

  it('rounds away float anomalies (5 decimal places)', () => {
    // 32px * 0.046875 = 1.5 exactly; 13px exercises the rounding path.
    expect(normalizeAbsoluteToRem('32px')).toBe('1.5rem');
    expect(normalizeAbsoluteToRem('13px')).toBe('0.60938rem');
  });

  it('returns null for relative/unknown values (left untouched)', () => {
    expect(normalizeAbsoluteToRem('1.2em')).toBeNull();
    expect(normalizeAbsoluteToRem('120%')).toBeNull();
    expect(normalizeAbsoluteToRem('')).toBeNull();
    expect(normalizeAbsoluteToRem('calc(1pt + 2px)')).toBeNull();
  });
});

describe('computeFontScale (legacy normalization math)', () => {
  it('is a 1.0 multiplier without book baseline metadata', () => {
    const { finalFSScalePct, finalLH } = computeFontScale(baseSpec);
    expect(finalFSScalePct).toBe(100);
    expect(finalLH).toBeCloseTo(1.5, 10);
  });

  it('normalizes font scale against the book base size (20px book → 80%)', () => {
    const { finalFSScalePct } = computeFontScale({ ...baseSpec, baseFontSize: 20 });
    expect(finalFSScalePct).toBe(Math.round(100 * (16 / 20)));
  });

  it('normalizes line height against the book native ratio', () => {
    // book ratio 1.8 (28.8/16) vs target 1.35 → factor 0.75
    const { finalLH } = computeFontScale({
      ...baseSpec,
      baseFontSize: 16,
      baseLineHeight: 28.8,
    });
    expect(finalLH).toBeCloseTo(1.5 * (1.35 / 1.8), 10);
  });

  it('enforces the pinyin minimum leading of 1.8', () => {
    const { finalLH } = computeFontScale({ ...baseSpec, showPinyin: true });
    expect(finalLH).toBe(1.8);
    const tall = computeFontScale({ ...baseSpec, showPinyin: true, lineHeight: 2.2 });
    expect(tall.finalLH).toBeCloseTo(2.2, 10);
  });
});

describe('buildForcedStylesCss (legacy CSS gate)', () => {
  it('always emits the html font-size scale', () => {
    const css = buildForcedStylesCss(baseSpec, 87);
    expect(css).toContain('font-size: 87% !important');
    // light theme without force-font: no color mapping
    expect(css).not.toContain('color:');
  });

  it('emits theme colors for dark even without force-font', () => {
    const css = buildForcedStylesCss({ ...baseSpec, currentTheme: 'dark' }, 100);
    expect(css).toContain('background: #1a1a1a !important');
    expect(css).toContain('color: #f5f5f5 !important');
    expect(css).toContain('color: #6ab0f3 !important'); // links
    expect(css).not.toContain('font-family'); // not forced
  });

  it('emits font-family/line-height only under shouldForceFont', () => {
    const css = buildForcedStylesCss(
      { ...baseSpec, shouldForceFont: true, fontFamily: 'OpenDyslexic', lineHeight: 1.7 },
      100,
    );
    expect(css).toContain('font-family: OpenDyslexic !important');
    expect(css).toContain('line-height: 1.7 !important');
    // light + forced font maps light colors
    expect(css).toContain('background: #ffffff !important');
  });

  it('uses the custom theme colors for the custom theme', () => {
    const css = buildForcedStylesCss(
      { ...baseSpec, currentTheme: 'custom', customTheme: { bg: '#111111', fg: '#eeeeee' } },
      100,
    );
    expect(css).toContain('background: #111111 !important');
    expect(css).toContain('color: #eeeeee !important');
  });
});

describe('applyReaderTheme reflow semantics (D5)', () => {
  const makeRendition = () => {
    const themes = {
      register: vi.fn(),
      select: vi.fn(),
      fontSize: vi.fn(),
      font: vi.fn(),
      default: vi.fn(),
    };
    const rendition = {
      themes,
      flow: vi.fn(),
      display: vi.fn(),
      getContents: vi.fn(() => []),
      location: { start: { cfi: 'epubcfi(/6/4!/4/2)' } },
    } as unknown as Rendition;
    return { rendition, themes };
  };

  it('does NOT reflow or re-display on a colors/typography-only update', () => {
    const { rendition, themes } = makeRendition();
    applyReaderTheme(rendition, baseSpec, { flowModeChanged: false });

    expect(rendition.flow).not.toHaveBeenCalled();
    expect(rendition.display).not.toHaveBeenCalled();
    // …but the presentation itself was applied.
    expect(themes.select).toHaveBeenCalledWith('light');
    expect(themes.fontSize).toHaveBeenCalledWith('100%');
    expect(themes.font).toHaveBeenCalledWith('serif');
  });

  it('reflows and restores the location when the mode changed', () => {
    const { rendition } = makeRendition();
    applyReaderTheme(rendition, { ...baseSpec, viewMode: 'scrolled' }, { flowModeChanged: true });

    expect(rendition.flow).toHaveBeenCalledWith('scrolled-doc');
    expect(rendition.display).toHaveBeenCalledWith('epubcfi(/6/4!/4/2)');
  });

  it('returns the forced-styles applier for content-hook re-application', () => {
    const { rendition } = makeRendition();
    const doc = document.implementation.createHTMLDocument('s');
    (rendition.getContents as ReturnType<typeof vi.fn>).mockReturnValue([{ document: doc }]);

    const reapply = applyReaderTheme(rendition, baseSpec, { flowModeChanged: false });
    reapply();

    expect(doc.getElementById('force-theme-style')).not.toBeNull();
  });
});
