/**
 * highlightStyles is the single registry for highlight rendering, and its
 * whole purpose is that the emitted CSS and style objects stay
 * byte-identical to the three sources it consolidated. That makes it a
 * characterization module: anything that changes a colour, an opacity or a
 * blend mode is a visible regression in the reader, and nothing was
 * asserting on the output.
 */
import { describe, expect, it } from 'vitest';
import {
  AUDIO_BOOKMARK_PENDING_CLASS,
  HIGHLIGHT_LAYERS,
  annotationClassName,
  iframeHighlightThemeCss,
  parentHighlightCss,
} from './highlightStyles';

describe('annotationClassName', () => {
  it.each([
    ['yellow', 'highlight-yellow'],
    ['green', 'highlight-green'],
    ['blue', 'highlight-blue'],
    ['red', 'highlight-red'],
  ])('maps %s to %s', (color, expected) => {
    expect(annotationClassName(color)).toBe(expected);
  });

  /* Yellow is the fallback, so an unknown colour still renders. */
  it('falls back to yellow for an unknown colour', () => {
    expect(annotationClassName('chartreuse')).toBe('highlight-yellow');
  });

  it('falls back to yellow for undefined and empty input', () => {
    expect(annotationClassName(undefined)).toBe('highlight-yellow');
    expect(annotationClassName('')).toBe('highlight-yellow');
  });

  it('is case sensitive — the stored values are lowercase', () => {
    expect(annotationClassName('Yellow')).toBe('highlight-yellow');
    expect(annotationClassName('GREEN')).toBe('highlight-yellow');
  });
});

describe('HIGHLIGHT_LAYERS registry', () => {
  it('defines exactly the five reserved layers', () => {
    expect(Object.keys(HIGHLIGHT_LAYERS).sort()).toEqual(
      ['annotation', 'debug', 'history', 'search', 'tts'],
    );
  });

  it.each([
    ['annotation', 'highlight-yellow'],
    ['tts', 'tts-highlight'],
    ['history', 'reading-history-highlight'],
    ['debug', 'debug-analysis-highlight'],
    ['search', 'search-highlight'],
  ])('%s defaults to the %s class', (layer, className) => {
    expect(HIGHLIGHT_LAYERS[layer as keyof typeof HIGHLIGHT_LAYERS].defaultClassName).toBe(className);
  });

  /*
   * Only tts runs the orphaned-SVG sweep. Turning it on elsewhere makes
   * every add/remove walk the DOM; turning it off on tts brings back the
   * orphaned highlights it exists to clean up.
   */
  it('sweeps orphans on tts only', () => {
    expect(HIGHLIGHT_LAYERS.tts.sweepOrphans).toBe(true);
    expect(HIGHLIGHT_LAYERS.tts.sweepClassName).toBe('tts-highlight');

    for (const layer of ['annotation', 'history', 'debug', 'search'] as const) {
      expect(HIGHLIGHT_LAYERS[layer].sweepOrphans).toBe(false);
      expect(HIGHLIGHT_LAYERS[layer].sweepClassName).toBeUndefined();
    }
  });

  /*
   * history is the only layer with a default styles object, pinned verbatim
   * including the dead camelCase keys — see the module docs.
   */
  it('carries the history default styles verbatim', () => {
    expect(HIGHLIGHT_LAYERS.history.defaultStyles).toEqual({
      fill: 'gray',
      fillOpacity: '0.1',
      mixBlendMode: 'multiply',
    });
  });

  it('leaves every other layer on the 5-arg call form', () => {
    for (const layer of ['annotation', 'tts', 'debug', 'search'] as const) {
      expect(HIGHLIGHT_LAYERS[layer].defaultStyles).toBeUndefined();
    }
  });

  it('names the pending audio-bookmark class', () => {
    expect(AUDIO_BOOKMARK_PENDING_CLASS).toBe('versicle-audio-bookmark-pending');
  });
});

describe('parentHighlightCss', () => {
  const light = parentHighlightCss('light');
  const dark = parentHighlightCss('dark');

  it('emits a rule for every annotation colour', () => {
    for (const [cls, fill] of [
      ['highlight-yellow', '#fde047'],
      ['highlight-green', '#86efac'],
      ['highlight-blue', '#93c5fd'],
      ['highlight-red', '#fca5a5'],
    ]) {
      expect(light).toContain(`.${cls} {`);
      expect(light).toContain(`fill: ${fill};`);
    }
  });

  /* 0.8 light / 0.4 dark, multiply / screen — the pinned baseline. */
  it('uses the light opacity and blend mode', () => {
    expect(light).toContain('fill-opacity: 0.8;');
    expect(light).toContain('mix-blend-mode: multiply;');
    expect(light).not.toContain('fill-opacity: 0.4;');
    expect(light).not.toContain('screen');
  });

  it('uses the dark opacity and blend mode', () => {
    expect(dark).toContain('fill-opacity: 0.4;');
    expect(dark).toContain('mix-blend-mode: screen;');
    expect(dark).not.toContain('mix-blend-mode: multiply;');
  });

  /* Only the exact string 'dark' switches themes. */
  it('treats any non-dark theme as light', () => {
    for (const theme of ['light', 'sepia', 'Dark', '', 'DARK']) {
      expect(parentHighlightCss(theme)).toContain('fill-opacity: 0.8;');
    }
  });

  it('emits the striped pending-bookmark rule', () => {
    expect(light).toContain(`.${AUDIO_BOOKMARK_PENDING_CLASS} {`);
    expect(light).toContain('fill: url(#striped-highlight);');
  });

  it('emits the search highlight with its fade animation', () => {
    expect(light).toContain('.search-highlight {');
    expect(light).toContain('animation: search-highlight-fade 10s forwards;');
    expect(light).toContain('@keyframes search-highlight-fade');
  });

  /*
   * The fade holds at full opacity to 80% and only then drops to 0 — a
   * mutated keyframe would make the search highlight vanish immediately.
   */
  it('holds the fade until 80% and ends fully transparent', () => {
    expect(light).toMatch(/0%\s*\{\s*fill-opacity: 0\.8;/);
    expect(light).toMatch(/80%\s*\{\s*fill-opacity: 0\.8;/);
    expect(light).toMatch(/100%\s*\{\s*fill-opacity: 0;/);
  });

  it('scales the fade keyframes with the dark opacity too', () => {
    expect(dark).toMatch(/0%\s*\{\s*fill-opacity: 0\.4;/);
    expect(dark).toMatch(/100%\s*\{\s*fill-opacity: 0;/);
  });
});

describe('iframeHighlightThemeCss', () => {
  const light = iframeHighlightThemeCss('light');
  const dark = iframeHighlightThemeCss('dark');

  it('emits a rule per highlight class', () => {
    expect(Object.keys(light).sort()).toEqual([
      '.highlight-blue',
      '.highlight-green',
      '.highlight-red',
      '.highlight-yellow',
      '.tts-highlight',
    ]);
  });

  it.each([
    ['.tts-highlight', '#fde047', '253, 224, 71'],
    ['.highlight-yellow', '#fde047', '253, 224, 71'],
    ['.highlight-green', '#86efac', '134, 239, 172'],
    ['.highlight-blue', '#93c5fd', '147, 197, 253'],
    ['.highlight-red', '#fca5a5', '252, 165, 165'],
  ])('%s pins its fill and background rgb', (cls, fill, rgb) => {
    expect(light[cls].fill).toBe(fill);
    expect(light[cls]['background-color']).toBe(`rgba(${rgb}, 0.3)`);
    expect(dark[cls]['background-color']).toBe(`rgba(${rgb}, 0.4)`);
  });

  /*
   * The iframe opacity baseline is 0.3 light / 0.4 dark — DIFFERENT from
   * the parent CSS's 0.8/0.4. Collapsing the two would be a silent visual
   * change, so both are pinned.
   */
  it('uses the iframe opacity baseline, not the parent one', () => {
    expect(light['.highlight-yellow']['fill-opacity']).toBe('0.3');
    expect(dark['.highlight-yellow']['fill-opacity']).toBe('0.4');
  });

  it('switches blend mode with the theme', () => {
    expect(light['.highlight-yellow']['mix-blend-mode']).toBe('multiply');
    expect(dark['.highlight-yellow']['mix-blend-mode']).toBe('screen');
  });

  it('treats any non-dark theme as light', () => {
    expect(iframeHighlightThemeCss('sepia')['.tts-highlight']['fill-opacity']).toBe('0.3');
    expect(iframeHighlightThemeCss('Dark')['.tts-highlight']['mix-blend-mode']).toBe('multiply');
  });

  it('gives every rule all four properties', () => {
    for (const rule of Object.values(light)) {
      expect(Object.keys(rule).sort()).toEqual([
        'background-color',
        'fill',
        'fill-opacity',
        'mix-blend-mode',
      ]);
    }
  });
});
