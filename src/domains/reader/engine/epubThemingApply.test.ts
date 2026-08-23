/**
 * `epubTheming` — the three rendition-facing entry points.
 *
 * epubThemingPure.test.ts owns the arithmetic and CSS-building helpers;
 * epubTheming.test.ts owns the legacy characterization pins. This file
 * covers what neither reaches: what `registerBaseThemes` / `applyReaderTheme`
 * actually push into epub.js, and the per-section normalization
 * `injectContentExtras` performs on a real (jsdom) document — including the
 * D5 rule that only a FLOW change reflows, since a spurious reflow per
 * settings tweak was the bug this contract exists to prevent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Contents, Rendition } from 'epubjs';
import {
  applyReaderTheme,
  injectContentExtras,
  registerBaseThemes,
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

interface ThemesSpy {
  registered: Array<[string, Record<string, unknown>]>;
  defaults: unknown[];
  selected: string[];
  fontSizes: string[];
  fonts: string[];
}

interface RenditionSpy {
  rendition: Rendition;
  themes: ThemesSpy;
  flows: string[];
  displayed: string[];
  contents: Contents[];
}

const makeRendition = (
  over: { location?: unknown; contents?: Contents[] } = {}
): RenditionSpy => {
  const themes: ThemesSpy = {
    registered: [],
    defaults: [],
    selected: [],
    fontSizes: [],
    fonts: [],
  };
  const flows: string[] = [];
  const displayed: string[] = [];
  const contents = over.contents ?? [];
  const rendition = {
    themes: {
      register: (name: string, rules: Record<string, unknown>) =>
        themes.registered.push([name, rules]),
      default: (rules: unknown) => themes.defaults.push(rules),
      select: (name: string) => themes.selected.push(name),
      fontSize: (size: string) => themes.fontSizes.push(size),
      font: (family: string) => themes.fonts.push(family),
    },
    location: over.location,
    flow: (mode: string) => flows.push(mode),
    display: (target: string) => displayed.push(target),
    getContents: () => contents,
  } as unknown as Rendition;
  return { rendition, themes, flows, displayed, contents };
};

/**
 * Sections are real iframes at runtime; jsdom only builds a live
 * `styleSheets` collection for a document with a browsing context, so the
 * fixture uses one too rather than a detached `createHTMLDocument`.
 */
const frames: HTMLIFrameElement[] = [];
const makeContents = (html = '<p>Body</p>'): Contents => {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frames.push(frame);
  const doc = frame.contentDocument as Document;
  doc.body.innerHTML = html;
  return { document: doc } as unknown as Contents;
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  while (frames.length) frames.pop()?.remove();
});

describe('registerBaseThemes', () => {
  it('registers exactly light, dark and sepia', () => {
    const r = makeRendition();

    registerBaseThemes(r.rendition);

    expect(r.themes.registered.map(([name]) => name)).toEqual(['light', 'dark', 'sepia']);
  });

  it('gives each theme a distinct body background and foreground', () => {
    const r = makeRendition();

    registerBaseThemes(r.rendition);

    const bodies = r.themes.registered.map(
      ([, rules]) => (rules as Record<string, Record<string, string>>).body
    );
    expect(bodies).toEqual([
      { background: '#ffffff !important', color: '#000000 !important' },
      { background: '#1a1a1a !important', color: '#f5f5f5 !important' },
      { background: '#f4ecd8 !important', color: '#5b4636 !important' },
    ]);
  });

  it('forces publisher text to inherit, so a theme is never fought by the book', () => {
    const r = makeRendition();

    registerBaseThemes(r.rendition);

    for (const [, rules] of r.themes.registered) {
      expect((rules as Record<string, Record<string, string>>)['p, div, span, h1, h2, h3, h4, h5, h6']).toEqual({
        color: 'inherit !important',
        background: 'transparent !important',
      });
    }
  });

  it('gives dark a legible link colour, not the default blue', () => {
    const r = makeRendition();

    registerBaseThemes(r.rendition);

    const links = r.themes.registered.map(
      ([, rules]) => (rules as Record<string, Record<string, string>>).a.color
    );
    expect(links).toEqual(['#0000ee !important', '#6ab0f3 !important', '#0000ee !important']);
  });
});

describe('applyReaderTheme — what reaches epub.js', () => {
  it('registers the custom theme from the spec colours and selects the active one', () => {
    const r = makeRendition();

    applyReaderTheme(r.rendition, spec({ currentTheme: 'sepia', customTheme: { bg: '#111', fg: '#eee' } }), {
      flowModeChanged: false,
    });

    const [name, rules] = r.themes.registered[0];
    expect(name).toBe('custom');
    expect((rules as Record<string, Record<string, string>>).body).toEqual({
      background: '#111 !important',
      color: '#eee !important',
    });
    expect(r.themes.selected).toEqual(['sepia']);
  });

  it('falls back to white-on-black-on-blue when the custom colours are missing', () => {
    const r = makeRendition();

    applyReaderTheme(
      r.rendition,
      spec({ customTheme: undefined as unknown as ReaderThemeSpec['customTheme'] }),
      { flowModeChanged: false }
    );

    const rules = r.themes.registered[0][1] as Record<string, Record<string, string>>;
    expect(rules.body).toEqual({
      background: '#ffffff !important',
      color: '#000000 !important',
    });
    // The link fallback is the built-in blue, NOT the body foreground default.
    expect(rules.a).toEqual({ color: '#0000ee !important' });
  });

  it('uses the custom FOREGROUND for links when one is set', () => {
    const r = makeRendition();

    applyReaderTheme(r.rendition, spec({ customTheme: { bg: '#000', fg: '#abcdef' } }), {
      flowModeChanged: false,
    });

    const rules = r.themes.registered[0][1] as Record<string, Record<string, string>>;
    expect(rules.a).toEqual({ color: '#abcdef !important' });
  });

  it('pushes the font size as a percentage and the NORMALIZED family', () => {
    const r = makeRendition();

    applyReaderTheme(r.rendition, spec({ fontSize: 125, fontFamily: 'PT Sans Narrow' }), {
      flowModeChanged: false,
    });

    expect(r.themes.fontSizes).toEqual(['125%']);
    expect(r.themes.fonts).toEqual(['Versicle Sans Narrow']);
  });

  it('publishes the computed line height to both p and body', () => {
    const r = makeRendition();

    applyReaderTheme(r.rendition, spec({ lineHeight: 1.75 }), { flowModeChanged: false });

    const lineHeightRules = r.themes.defaults.find(
      (d) => typeof d === 'object' && d !== null && 'p' in (d as object)
    ) as { p: Record<string, string>; body: Record<string, string> };
    expect(lineHeightRules.p['line-height']).toBe('1.75 !important');
    expect(lineHeightRules.body['line-height']).toBe(lineHeightRules.p['line-height']);
  });

  it('does NOT reflow when only colours or typography changed (D5)', () => {
    const r = makeRendition({ location: { start: { cfi: 'epubcfi(here)' } } });

    applyReaderTheme(r.rendition, spec(), { flowModeChanged: false });

    expect(r.flows).toEqual([]);
    expect(r.displayed).toEqual([]);
  });

  it('reflows and restores the position when the flow mode changed', () => {
    const r = makeRendition({ location: { start: { cfi: 'epubcfi(here)' } } });

    applyReaderTheme(r.rendition, spec({ viewMode: 'scrolled' }), { flowModeChanged: true });

    expect(r.flows).toEqual(['scrolled-doc']);
    expect(r.displayed).toEqual(['epubcfi(here)']);
  });

  it('maps paginated mode to the paginated flow', () => {
    const r = makeRendition({ location: { start: { cfi: 'x' } } });

    applyReaderTheme(r.rendition, spec({ viewMode: 'paginated' }), { flowModeChanged: true });

    expect(r.flows).toEqual(['paginated']);
  });

  it('reflows without a restore when there is no location yet', () => {
    const r = makeRendition({ location: undefined });

    applyReaderTheme(r.rendition, spec({ viewMode: 'scrolled' }), { flowModeChanged: true });

    expect(r.flows).toEqual(['scrolled-doc']);
    expect(r.displayed).toEqual([]);
  });

  it('injects the forced styles into every live section immediately', () => {
    const one = makeContents();
    const two = makeContents();
    const r = makeRendition({ contents: [one, two] });

    applyReaderTheme(r.rendition, spec({ shouldForceFont: true }), { flowModeChanged: false });

    for (const contents of [one, two]) {
      expect(contents.document.getElementById('force-theme-style')).not.toBeNull();
    }
  });

  it('skips a content view whose document is gone', () => {
    const r = makeRendition({ contents: [{ document: null } as unknown as Contents] });

    expect(() =>
      applyReaderTheme(r.rendition, spec(), { flowModeChanged: false })
    ).not.toThrow();
  });

  it('returns a re-applier the content hook can call on each section load', () => {
    const contents = makeContents();
    const r = makeRendition({ contents: [contents] });

    const reapply = applyReaderTheme(r.rendition, spec(), { flowModeChanged: false });
    contents.document.getElementById('force-theme-style')?.remove();
    reapply();

    expect(contents.document.getElementById('force-theme-style')).not.toBeNull();
  });
});

describe('injectContentExtras — per-section normalization', () => {
  const reapply = () => undefined;

  it('does nothing when the section has no document', () => {
    expect(() =>
      injectContentExtras({ document: null } as unknown as Contents, {
        viewMode: 'paginated',
        reapplyForcedStyles: reapply,
      })
    ).not.toThrow();
  });

  it('rewrites absolute INLINE font sizes and line heights to rem', () => {
    // 1px = 0.046875rem → 24px = 1.125rem, 32px = 1.5rem.
    const contents = makeContents('<p id="t" style="font-size: 24px; line-height: 32px">x</p>');

    injectContentExtras(contents, { viewMode: 'paginated', reapplyForcedStyles: reapply });

    const el = contents.document.getElementById('t') as HTMLElement;
    expect(el.style.fontSize).toBe('1.125rem');
    expect(el.style.lineHeight).toBe('1.5rem');
  });

  it('leaves a relative inline unit alone', () => {
    const contents = makeContents('<p id="t" style="font-size: 1.2em">x</p>');

    injectContentExtras(contents, { viewMode: 'paginated', reapplyForcedStyles: reapply });

    expect((contents.document.getElementById('t') as HTMLElement).style.fontSize).toBe('1.2em');
  });

  it('rewrites absolute units inside the section STYLESHEET too', () => {
    const contents = makeContents('<style>p { font-size: 32px; line-height: 48px; }</style><p>x</p>');

    injectContentExtras(contents, { viewMode: 'paginated', reapplyForcedStyles: reapply });

    const rule = (contents.document.styleSheets[0].cssRules[0] as CSSStyleRule).style;
    expect(rule.fontSize).toBe('1.5rem');
    expect(rule.lineHeight).toBe('2.25rem');
  });

  it('descends into grouped rules (media queries)', () => {
    const contents = makeContents(
      '<style>@media screen { p { font-size: 32px; } }</style><p>x</p>'
    );

    injectContentExtras(contents, { viewMode: 'paginated', reapplyForcedStyles: reapply });

    const media = contents.document.styleSheets[0].cssRules[0] as CSSMediaRule;
    expect((media.cssRules[0] as CSSStyleRule).style.fontSize).toBe('1.5rem');
  });

  it('re-applies the forced styles for the newly loaded section', () => {
    const reapplySpy = vi.fn();
    const contents = makeContents();

    injectContentExtras(contents, { viewMode: 'paginated', reapplyForcedStyles: reapplySpy });

    expect(reapplySpy).toHaveBeenCalledTimes(1);
  });

  it('injects the static reader styles', () => {
    const contents = makeContents();

    injectContentExtras(contents, { viewMode: 'paginated', reapplyForcedStyles: reapply });

    expect(contents.document.getElementById('reader-static-styles')).not.toBeNull();
  });

  it('adds a bottom spacer in SCROLLED mode only, exactly once', () => {
    const contents = makeContents();

    injectContentExtras(contents, { viewMode: 'scrolled', reapplyForcedStyles: reapply });
    injectContentExtras(contents, { viewMode: 'scrolled', reapplyForcedStyles: reapply });

    const spacers = contents.document.querySelectorAll('#reader-bottom-spacer');
    expect(spacers).toHaveLength(1);
    const spacer = spacers[0] as HTMLElement;
    expect(spacer.style.height).toBe('150px');
    expect(spacer.style.clear).toBe('both');
  });

  it('adds no spacer in paginated mode', () => {
    const contents = makeContents();

    injectContentExtras(contents, { viewMode: 'paginated', reapplyForcedStyles: reapply });

    expect(contents.document.getElementById('reader-bottom-spacer')).toBeNull();
  });

  /**
   * Watch a parsed rule for font-size writes. The normalization pass is the
   * only thing that would write one, so a zero count proves the sheet was
   * skipped — observable even for `reader-static-styles`, whose rules the
   * static injection later replaces wholesale.
   */
  const watchFontSizeWrites = (sheet: CSSStyleSheet): string[] => {
    const writes: string[] = [];
    const style = (sheet.cssRules[0] as CSSStyleRule).style;
    const initial = style.fontSize;
    Object.defineProperty(style, 'fontSize', {
      get: () => initial,
      set: (v: string) => writes.push(v),
      configurable: true,
    });
    return writes;
  };

  const tagOwner = (contents: Contents, id: string): CSSStyleSheet => {
    const sheet = contents.document.styleSheets[0];
    // jsdom leaves `ownerNode` unset on parsed sheets; a browser links it to
    // the <style> element, which is how the skip list recognizes our own.
    Object.defineProperty(sheet, 'ownerNode', {
      value: contents.document.querySelector('style'),
      configurable: true,
    });
    (sheet.ownerNode as Element).id = id;
    return sheet;
  };

  it.each(['force-theme-style', 'reader-static-styles'])(
    'skips OUR OWN injected sheet #%s — its rules are already normalized',
    (id) => {
      const contents = makeContents(
        '<style>p { font-size: 32px; }</style><p style="font-size: 32px">x</p>'
      );
      const writes = watchFontSizeWrites(tagOwner(contents, id));

      injectContentExtras(contents, { viewMode: 'paginated', reapplyForcedStyles: reapply });

      expect(writes).toEqual([]);
      // …while the section's own inline style right beside it IS rewritten.
      expect((contents.document.querySelector('p[style]') as HTMLElement).style.fontSize).toBe(
        '1.5rem'
      );
    }
  );

  it('rewrites a sheet whose owner element carries a DIFFERENT id', () => {
    const contents = makeContents('<style>p { font-size: 32px; }</style><p>x</p>');
    const writes = watchFontSizeWrites(tagOwner(contents, 'publisher-styles'));

    injectContentExtras(contents, { viewMode: 'paginated', reapplyForcedStyles: reapply });

    expect(writes).toEqual(['1.5rem']);
  });

  it('rewrites a publisher sheet that has no owner element at all', () => {
    const contents = makeContents('<style>p { font-size: 32px; }</style><p>x</p>');

    injectContentExtras(contents, { viewMode: 'paginated', reapplyForcedStyles: reapply });

    expect((contents.document.styleSheets[0].cssRules[0] as CSSStyleRule).style.fontSize).toBe(
      '1.5rem'
    );
  });
});
