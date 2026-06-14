/**
 * HighlightLayerManager unit suite (Phase 6 §4): per-layer bookkeeping,
 * idempotent add, layer isolation, the ONE orphan sweep (tts only), and the
 * preserved epub.js call shapes (5-arg vs 6-arg) the entry-gate
 * characterization pins depend on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HighlightLayerManager, type AnnotatingRendition } from './HighlightLayerManager';

const makePaneWithOrphans = (count: number) => {
  const pane = document.createElement('div');
  pane.innerHTML = Array.from({ length: count })
    .map(() => '<svg><g class="tts-highlight"></g></svg>')
    .join('');
  return pane;
};

type AddFn = AnnotatingRendition['annotations']['add'];
type RemoveFn = AnnotatingRendition['annotations']['remove'];

describe('HighlightLayerManager', () => {
  let add: ReturnType<typeof vi.fn<AddFn>>;
  let remove: ReturnType<typeof vi.fn<RemoveFn>>;
  let pane: HTMLElement;
  let rendition: AnnotatingRendition;
  let manager: HighlightLayerManager;

  beforeEach(() => {
    add = vi.fn<AddFn>();
    remove = vi.fn<RemoveFn>();
    pane = makePaneWithOrphans(0);
    rendition = {
      annotations: { add, remove },
      views: () => [{ pane: { element: pane } }],
    };
    manager = new HighlightLayerManager(rendition);
  });

  it('adds with the layer default class and the 5-arg form when the layer has no styles', () => {
    const onClick = () => {};
    manager.add('tts', 'cfi-1', { onClick });
    expect(add).toHaveBeenCalledWith('highlight', 'cfi-1', {}, onClick, 'tts-highlight');
    expect(manager.count('tts')).toBe(1);
  });

  it('adds with the registry styles (6-arg form) for the history layer, cb null passthrough', () => {
    manager.add('history', 'cfi-h', { onClick: null });
    expect(add).toHaveBeenCalledWith('highlight', 'cfi-h', {}, null, 'reading-history-highlight', {
      fill: 'gray',
      fillOpacity: '0.1',
      mixBlendMode: 'multiply',
    });
  });

  it('honors per-call className and styles (debug layer)', () => {
    manager.add('debug', 'cfi-d', {
      className: 'temp-table-highlight',
      onClick: null,
      styles: { fill: 'yellow' },
    });
    expect(add).toHaveBeenCalledWith('highlight', 'cfi-d', {}, null, 'temp-table-highlight', {
      fill: 'yellow',
    });
  });

  it('is idempotent per (layer, cfi)', () => {
    manager.add('annotation', 'cfi-a', { className: 'highlight-blue' });
    manager.add('annotation', 'cfi-a', { className: 'highlight-blue' });
    expect(add).toHaveBeenCalledTimes(1);
    expect(manager.count('annotation')).toBe(1);
  });

  it('isolates layers: the same cfi can live on two layers; removing one leaves the other tracked', () => {
    manager.add('annotation', 'cfi-x', {});
    manager.add('tts', 'cfi-x', {});
    expect(manager.count('annotation')).toBe(1);
    expect(manager.count('tts')).toBe(1);

    manager.remove('tts', 'cfi-x');
    expect(manager.count('tts')).toBe(0);
    expect(manager.count('annotation')).toBe(1);
    expect(manager.has('annotation', 'cfi-x')).toBe(true);
  });

  it('sweeps orphaned SVG nodes before adding — ONLY for sweep layers (tts)', () => {
    pane.innerHTML = '<svg><g class="tts-highlight"></g><g class="highlight-yellow"></g></svg>';

    manager.add('annotation', 'cfi-a', {});
    // annotation layer never sweeps
    expect(pane.querySelectorAll('g.tts-highlight').length).toBe(1);

    manager.add('tts', 'cfi-t', {});
    expect(pane.querySelectorAll('g.tts-highlight').length).toBe(0);
    // and it never touches other layers' nodes
    expect(pane.querySelectorAll('g.highlight-yellow').length).toBe(1);
  });

  it('sweeps after remove for sweep layers', () => {
    manager.add('tts', 'cfi-t', {});
    pane.innerHTML = '<svg><g class="tts-highlight"></g></svg>'; // orphan appears later
    manager.remove('tts', 'cfi-t');
    expect(remove).toHaveBeenCalledWith('cfi-t', 'highlight');
    expect(pane.querySelectorAll('g.tts-highlight').length).toBe(0);
  });

  it('clear(layer) removes every tracked cfi of that layer only', () => {
    manager.add('debug', 'cfi-1', { styles: {} });
    manager.add('debug', 'cfi-2', { styles: {} });
    manager.add('annotation', 'cfi-3', {});

    manager.clear('debug');
    expect(remove).toHaveBeenCalledWith('cfi-1', 'highlight');
    expect(remove).toHaveBeenCalledWith('cfi-2', 'highlight');
    expect(manager.count('debug')).toBe(0);
    expect(manager.count('annotation')).toBe(1);
  });

  it('logs-and-swallows epub.js add failures without tracking the cfi', () => {
    add.mockImplementation(() => {
      throw new Error('no view');
    });
    expect(() => manager.add('annotation', 'cfi-err', {})).not.toThrow();
    expect(manager.has('annotation', 'cfi-err')).toBe(false);
    expect(manager.count('annotation')).toBe(0);
  });

  it('logs-and-swallows epub.js remove failures but still drops the bookkeeping', () => {
    manager.add('annotation', 'cfi-a', {});
    remove.mockImplementation(() => {
      throw new Error('detached');
    });
    expect(() => manager.remove('annotation', 'cfi-a')).not.toThrow();
    expect(manager.has('annotation', 'cfi-a')).toBe(false);
  });

  it('tolerates renditions without views() (sweep is a no-op)', () => {
    const bare = new HighlightLayerManager({ annotations: { add, remove } });
    expect(() => bare.add('tts', 'cfi-t', {})).not.toThrow();
    expect(add).toHaveBeenCalled();
  });

  it('detach() drops bookkeeping without DOM/epub.js calls', () => {
    manager.add('annotation', 'cfi-a', {});
    manager.detach();
    expect(manager.count('annotation')).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });
});
