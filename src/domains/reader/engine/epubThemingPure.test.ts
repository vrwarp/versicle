/**
 * The pure half of epubTheming: unit normalization, font-scale maths and
 * the forced-styles CSS. These are characterization functions — the whole
 * point is that a book renders exactly as it did before the extraction, so
 * every constant in them is load-bearing and a mutated one is a visible
 * typography change rather than a crash.
 */
import { describe, expect, it } from 'vitest';
import {
  buildForcedStylesCss,
  computeFontScale,
  normalizeAbsoluteToRem,
  normalizeFontFamily,
  type ReaderThemeSpec,
} from './epubTheming';

const spec = (over: Partial<ReaderThemeSpec> = {}): ReaderThemeSpec => ({
  viewMode: 'paginated',
  currentTheme: 'light',
  customTheme: { bg: '#ffffff', fg: '#000000' },
  fontFamily: 'Georgia',
  fontSize: 100,
  lineHeight: 1.5,
  shouldForceFont: false,
  showPinyin: false,
  ...over,
});

describe('normalizeAbsoluteToRem', () => {
  it.each([
    ['xx-small', '0.5625rem'],
    ['x-small', '0.625rem'],
    ['small', '0.8125rem'],
    ['medium', '1rem'],
    ['large', '1.125rem'],
    ['x-large', '1.5rem'],
    ['xx-large', '2rem'],
  ])('maps the named size %s', (input, expected) => {
    expect(normalizeAbsoluteToRem(input)).toBe(expected);
  });

  it('matches named sizes case-insensitively and ignores padding', () => {
    expect(normalizeAbsoluteToRem('  MEDIUM  ')).toBe('1rem');
    expect(normalizeAbsoluteToRem('X-Large')).toBe('1.5rem');
  });

  /* 16pt = 1rem is the anchor the whole table is derived from. */
  it.each([
    ['16pt', '1rem'],
    ['8pt', '0.5rem'],
    ['16px', '0.75rem'],
    ['1in', '4.5rem'],
    ['1cm', '1.771875rem'],
    ['1mm', '0.1771875rem'],
    ['1pc', '0.75rem'],
    ['1q', '0.04430rem'],
  ])('converts %s', (input, expected) => {
    const result = normalizeAbsoluteToRem(input);

    // 1Q rounds to five places; compare numerically to stay readable.
    expect(parseFloat(String(result))).toBeCloseTo(parseFloat(expected), 4);
    expect(result).toMatch(/rem$/);
  });

  it('accepts fractional values', () => {
    expect(normalizeAbsoluteToRem('12.5pt')).toBe('0.78125rem');
  });

  it('is case-insensitive about units', () => {
    expect(normalizeAbsoluteToRem('16PT')).toBe('1rem');
    expect(normalizeAbsoluteToRem('1Q')).toBe(normalizeAbsoluteToRem('1q'));
  });

  /*
   * Rounding to five places exists to avoid 1.5000000000000002rem leaking
   * into the stylesheet.
   */
  it('rounds to five decimal places', () => {
    const result = normalizeAbsoluteToRem('3px');

    expect(result).toBe('0.14063rem');
    expect(String(result)).not.toContain('0000000');
  });

  it('returns null for relative units it must not touch', () => {
    for (const value of ['1em', '2rem', '50%', '1vh', '1ex', '1ch']) {
      expect(normalizeAbsoluteToRem(value)).toBeNull();
    }
  });

  it('returns null for empty or unparseable input', () => {
    expect(normalizeAbsoluteToRem('')).toBeNull();
    expect(normalizeAbsoluteToRem('inherit')).toBeNull();
    expect(normalizeAbsoluteToRem('16')).toBeNull();
    expect(normalizeAbsoluteToRem('pt')).toBeNull();
    expect(normalizeAbsoluteToRem('16 pt')).toBeNull();
  });

  it('returns null for a value with trailing junk', () => {
    expect(normalizeAbsoluteToRem('16pt !important')).toBeNull();
  });
});

describe('normalizeFontFamily', () => {
  it('rewrites the bundled narrow face', () => {
    expect(normalizeFontFamily('PT Sans Narrow')).toBe('Versicle Sans Narrow');
  });

  it('rewrites every occurrence in a stack', () => {
    expect(normalizeFontFamily('PT Sans Narrow, serif, PT Sans Narrow'))
      .toBe('Versicle Sans Narrow, serif, Versicle Sans Narrow');
  });

  it('leaves other families alone', () => {
    expect(normalizeFontFamily('Georgia, serif')).toBe('Georgia, serif');
    expect(normalizeFontFamily('PT Sans')).toBe('PT Sans');
  });

  it('handles an empty stack', () => {
    expect(normalizeFontFamily('')).toBe('');
  });
});

describe('computeFontScale', () => {
  /* No book metadata means a 1.0 multiplier — the user's preference verbatim. */
  it('passes the preference through when the book reports no baseline', () => {
    expect(computeFontScale(spec({ fontSize: 120, lineHeight: 1.5 })))
      .toEqual({ finalFSScalePct: 120, finalLH: 1.5 });
  });

  it('scales down a book whose baseline font is larger than the target', () => {
    // 16 / 32 = 0.5
    expect(computeFontScale(spec({ fontSize: 100, baseFontSize: 32 })).finalFSScalePct).toBe(50);
  });

  it('scales up a book whose baseline font is smaller than the target', () => {
    expect(computeFontScale(spec({ fontSize: 100, baseFontSize: 8 })).finalFSScalePct).toBe(200);
  });

  it('rounds the scale to a whole percentage', () => {
    expect(Number.isInteger(computeFontScale(spec({ fontSize: 100, baseFontSize: 15 })).finalFSScalePct))
      .toBe(true);
  });

  it('normalizes line height against the book native ratio', () => {
    // Book ratio 2.0 vs target 1.35 -> factor 0.675
    const { finalLH } = computeFontScale(spec({ lineHeight: 2, baseFontSize: 16, baseLineHeight: 32 }));

    expect(finalLH).toBeCloseTo(2 * (1.35 / 2), 5);
  });

  it('derives the book line height from the target ratio when absent', () => {
    const { finalLH } = computeFontScale(spec({ lineHeight: 1.5, baseFontSize: 16 }));

    expect(finalLH).toBeCloseTo(1.5, 5);
  });

  /* Pinyin needs room above the line; the floor applies after normalization. */
  it('enforces the pinyin line-height floor', () => {
    const { finalLH } = computeFontScale(
      spec({ lineHeight: 1.2, showPinyin: true, baseFontSize: 16, baseLineHeight: 32 }),
    );

    expect(finalLH).toBe(1.8);
  });

  it('leaves a line height above the floor untouched when pinyin is on', () => {
    const { finalLH } = computeFontScale(spec({ lineHeight: 2.5, showPinyin: true }));

    expect(finalLH).toBeCloseTo(2.5, 5);
  });

  it('does not apply the floor when pinyin is off', () => {
    expect(computeFontScale(spec({ lineHeight: 1.2, showPinyin: false })).finalLH)
      .toBeCloseTo(1.2, 5);
  });

  it('treats a zero baseline as missing rather than dividing by zero', () => {
    const { finalFSScalePct, finalLH } = computeFontScale(
      spec({ fontSize: 100, baseFontSize: 0, baseLineHeight: 0 }),
    );

    expect(finalFSScalePct).toBe(100);
    expect(Number.isFinite(finalLH)).toBe(true);
  });
});

describe('buildForcedStylesCss', () => {
  /* Scaling is unconditional — normalization depends on it. */
  it('always emits the html font-size scale', () => {
    expect(buildForcedStylesCss(spec(), 137)).toContain('font-size: 137% !important;');
  });

  it('emits nothing but scaling for an unforced light theme', () => {
    const css = buildForcedStylesCss(spec({ currentTheme: 'light', shouldForceFont: false }), 100);

    expect(css).toContain('font-size: 100%');
    expect(css).not.toContain('background:');
    expect(css).not.toContain('color:');
  });

  it.each([
    ['dark', '#1a1a1a', '#f5f5f5', '#6ab0f3'],
    ['sepia', '#f4ecd8', '#5b4636', '#0000ee'],
  ])('maps the %s palette even without forced fonts', (theme, bg, fg, link) => {
    const css = buildForcedStylesCss(spec({ currentTheme: theme, shouldForceFont: false }), 100);

    expect(css).toContain(`background: ${bg} !important;`);
    expect(css).toContain(`color: ${fg} !important;`);
    expect(css).toContain(`color: ${link} !important;`);
  });

  it('uses the custom palette for the custom theme', () => {
    const css = buildForcedStylesCss(
      spec({ currentTheme: 'custom', customTheme: { bg: '#102030', fg: '#a0b0c0' } }),
      100,
    );

    expect(css).toContain('background: #102030 !important;');
    expect(css).toContain('color: #a0b0c0 !important;');
  });

  it('falls back to black on white when the custom palette is absent', () => {
    const css = buildForcedStylesCss(
      spec({ currentTheme: 'custom', customTheme: undefined as never }),
      100,
    );

    expect(css).toContain('background: #ffffff !important;');
    expect(css).toContain('color: #000000 !important;');
  });

  it('maps the light palette when fonts are forced', () => {
    const css = buildForcedStylesCss(spec({ currentTheme: 'light', shouldForceFont: true }), 100);

    expect(css).toContain('background: #ffffff !important;');
    expect(css).toContain('color: #000000 !important;');
    expect(css).toContain('color: #0000ee !important;');
  });

  it('emits the font block only when fonts are forced', () => {
    const forced = buildForcedStylesCss(spec({ shouldForceFont: true, fontFamily: 'Georgia' }), 100);
    const unforced = buildForcedStylesCss(spec({ currentTheme: 'dark', shouldForceFont: false }), 100);

    expect(forced).toContain('font-family: Georgia !important;');
    expect(forced).toContain('text-align: left !important;');
    expect(unforced).not.toContain('font-family:');
    expect(unforced).not.toContain('text-align:');
  });

  it('normalizes the forced font family', () => {
    const css = buildForcedStylesCss(spec({ shouldForceFont: true, fontFamily: 'PT Sans Narrow' }), 100);

    expect(css).toContain('font-family: Versicle Sans Narrow !important;');
  });

  it('emits the unnormalized line height in the forced block', () => {
    const css = buildForcedStylesCss(spec({ shouldForceFont: true, lineHeight: 1.75 }), 100);

    expect(css).toContain('line-height: 1.75 !important;');
  });

  it('keeps element backgrounds transparent so the body colour shows through', () => {
    const css = buildForcedStylesCss(spec({ currentTheme: 'dark' }), 100);

    expect(css).toContain('background-color: transparent !important;');
  });

  it('underlines links only on hover', () => {
    const css = buildForcedStylesCss(spec({ currentTheme: 'dark' }), 100);

    expect(css).toContain('text-decoration: none !important;');
    expect(css).toContain('a:hover, a:hover * {');
    expect(css).toContain('text-decoration: underline !important;');
  });
});
