/**
 * `HighlightLayerManager` — the bookkeeping arms the owning suite leaves
 * open: the sweep-layer asymmetry, the tolerated epub.js failures, and the
 * DOM sweep itself.
 *
 * A failed `annotations.add` must NOT be recorded — an entry the DOM does
 * not back makes the layer permanently un-addable at that CFI (add() is
 * idempotent by bookkeeping). A failed remove must still drop the entry,
 * for the mirror reason.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { HighlightLayerManager, type AnnotatingRendition } from './HighlightLayerManager';

interface Spy {
  manager: HighlightLayerManager;
  added: unknown[][];
  removed: unknown[][];
  panes: HTMLElement[];
  warnings: string[];
}

const build = (
  over: {
    addThrows?: boolean;
    removeThrows?: boolean;
    views?: () => Array<{ pane?: { element?: Element } }> | undefined;
    paneHtml?: string[];
  } = {}
): Spy => {
  const added: unknown[][] = [];
  const removed: unknown[][] = [];
  const warnings: string[] = [];
  const panes = (over.paneHtml ?? []).map((html) => {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el;
  });

  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
    warnings.push(a.map(String).join(' '));
  });

  const rendition = {
    annotations: {
      add: (...args: unknown[]) => {
        if (over.addThrows) throw new Error('epubjs add failed');
        added.push(args);
      },
      remove: (...args: unknown[]) => {
        if (over.removeThrows) throw new Error('epubjs remove failed');
        removed.push(args);
      },
    },
    views:
      over.views ??
      (() => panes.map((element) => ({ pane: { element } }))),
  } as unknown as AnnotatingRendition;

  return { manager: new HighlightLayerManager(rendition), added, removed, panes, warnings };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HighlightLayerManager.add — the call shapes', () => {
  it('uses the 6-arg form when the layer carries default styles', () => {
    const s = build();

    s.manager.add('history', 'cfi-1');

    expect(s.added[0]).toHaveLength(6);
    expect(s.added[0][4]).toBe('reading-history-highlight');
    expect(s.added[0][5]).toEqual({
      fill: 'gray',
      fillOpacity: '0.1',
      mixBlendMode: 'multiply',
    });
  });

  it('uses the 5-arg form when the layer has none', () => {
    const s = build();

    s.manager.add('annotation', 'cfi-1');

    expect(s.added[0]).toHaveLength(5);
    expect(s.added[0][4]).toBe('highlight-yellow');
  });

  it('an EXPLICITLY undefined styles option forces the 5-arg form', () => {
    const s = build();

    s.manager.add('history', 'cfi-1', { styles: undefined });

    expect(s.added[0]).toHaveLength(5);
  });

  it('honours a caller className and data bag, defaulting the bag to empty', () => {
    const s = build();
    const onClick = vi.fn();

    s.manager.add('annotation', 'cfi-1', { className: 'highlight-blue', onClick });
    s.manager.add('annotation', 'cfi-2', { data: { note: 1 } });

    expect(s.added[0][2]).toEqual({});
    expect(s.added[0][3]).toBe(onClick);
    expect(s.added[0][4]).toBe('highlight-blue');
    expect(s.added[1][2]).toEqual({ note: 1 });
  });

  it('is idempotent per (layer, cfi)', () => {
    const s = build();

    s.manager.add('annotation', 'cfi-1');
    s.manager.add('annotation', 'cfi-1');

    expect(s.added).toHaveLength(1);
    expect(s.manager.count('annotation')).toBe(1);
  });

  it('keeps layers independent', () => {
    const s = build();

    s.manager.add('annotation', 'cfi-1');
    s.manager.add('search', 'cfi-1');

    expect(s.manager.count('annotation')).toBe(1);
    expect(s.manager.count('search')).toBe(1);
    expect(s.manager.has('debug', 'cfi-1')).toBe(false);
  });

  it('does NOT record a highlight epub.js refused', () => {
    const s = build({ addThrows: true });

    s.manager.add('annotation', 'cfi-1');

    expect(s.manager.has('annotation', 'cfi-1')).toBe(false);
    expect(s.manager.count('annotation')).toBe(0);
    expect(s.warnings.some((w) => w.includes('Failed to add annotation highlight'))).toBe(true);
  });
});

describe('HighlightLayerManager.remove / clear', () => {
  it('removes from epub.js and drops the bookkeeping', () => {
    const s = build();
    s.manager.add('annotation', 'cfi-1');

    s.manager.remove('annotation', 'cfi-1');

    expect(s.removed).toEqual([['cfi-1', 'highlight']]);
    expect(s.manager.has('annotation', 'cfi-1')).toBe(false);
  });

  it('drops the bookkeeping even when epub.js throws', () => {
    const s = build({ removeThrows: true });
    s.manager.add('annotation', 'cfi-1');

    s.manager.remove('annotation', 'cfi-1');

    expect(s.manager.has('annotation', 'cfi-1')).toBe(false);
    expect(s.warnings.some((w) => w.includes('Failed to remove annotation highlight'))).toBe(true);
  });

  it('clears an entire layer, leaving its siblings alone', () => {
    const s = build();
    s.manager.add('annotation', 'a');
    s.manager.add('annotation', 'b');
    s.manager.add('search', 'c');

    s.manager.clear('annotation');

    expect(s.manager.count('annotation')).toBe(0);
    expect(s.manager.count('search')).toBe(1);
  });

  it('reports the tracked CFIs in insertion order', () => {
    const s = build();
    s.manager.add('annotation', 'a');
    s.manager.add('annotation', 'b');

    expect(s.manager.cfis('annotation')).toEqual(['a', 'b']);
    expect(s.manager.cfis('search')).toEqual([]);
  });

  it('detach drops the bookkeeping WITHOUT touching the DOM', () => {
    const s = build();
    s.manager.add('annotation', 'a');

    s.manager.detach();

    expect(s.manager.count('annotation')).toBe(0);
    expect(s.removed).toEqual([]);
  });
});

describe('HighlightLayerManager — the orphan sweep', () => {
  const orphanHtml = '<g class="tts-highlight"></g><g class="tts-highlight"></g><g class="other"></g>';

  it('sweeps for a sweep layer, on BOTH add and remove', () => {
    const s = build({ paneHtml: [orphanHtml] });

    s.manager.add('tts', 'cfi-1');

    expect(s.panes[0].querySelectorAll('g.tts-highlight')).toHaveLength(0);
    expect(s.panes[0].querySelectorAll('g.other')).toHaveLength(1);

    s.panes[0].innerHTML = orphanHtml;
    s.manager.remove('tts', 'cfi-1');
    expect(s.panes[0].querySelectorAll('g.tts-highlight')).toHaveLength(0);
  });

  it('does NOT sweep for a non-sweep layer', () => {
    const s = build({ paneHtml: ['<g class="highlight-yellow"></g>'] });

    s.manager.add('annotation', 'cfi-1');
    s.manager.remove('annotation', 'cfi-1');

    expect(s.panes[0].querySelectorAll('g.highlight-yellow')).toHaveLength(1);
  });

  it('sweeps every view that has a pane', () => {
    const s = build({ paneHtml: [orphanHtml, orphanHtml] });

    s.manager.sweepOrphans('tts');

    expect(s.panes[0].querySelectorAll('g.tts-highlight')).toHaveLength(0);
    expect(s.panes[1].querySelectorAll('g.tts-highlight')).toHaveLength(0);
  });

  it('falls back to the layer default class when no sweep class is declared', () => {
    const s = build({ paneHtml: ['<g class="highlight-yellow"></g>'] });

    s.manager.sweepOrphans('annotation');

    expect(s.panes[0].querySelectorAll('g.highlight-yellow')).toHaveLength(0);
  });

  it('skips views with no pane, and a rendition with no views at all', () => {
    const noPane = build({ views: () => [{}, { pane: {} }] });
    expect(() => noPane.manager.sweepOrphans('tts')).not.toThrow();

    const noViews = build({ views: () => undefined });
    expect(() => noViews.manager.sweepOrphans('tts')).not.toThrow();

    const noViewsFn = build({ views: undefined });
    expect(() => noViewsFn.manager.sweepOrphans('tts')).not.toThrow();
  });

  it('logs rather than throws when the sweep blows up mid-teardown', () => {
    const s = build({
      views: () => {
        throw new Error('panes gone');
      },
    });

    expect(() => s.manager.sweepOrphans('tts')).not.toThrow();
    expect(s.warnings.some((w) => w.includes('Manual DOM cleanup failed (tts)'))).toBe(true);
  });
});
