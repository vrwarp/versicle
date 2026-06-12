/**
 * HighlightLayerManager — the ONLY caller of epub.js `annotations.add/remove`
 * (Phase 6 §4, prep/phase6-reader-engine.md; exit gate: grep-zero
 * `annotations.add/remove` outside this module).
 *
 * Per-layer `Map<cfi, …>` bookkeeping with idempotent add; the orphaned-SVG
 * DOM sweep is implemented ONCE here, for layers marked `sweepOrphans`
 * (only 'tts' today) — semantics copied verbatim from the three duplicated
 * sweeps that previously lived in ReaderTTSController.tsx (:69-81, :107-118,
 * :143-154). The pre-manager epub.js call shapes are preserved exactly
 * (5-arg form when no styles object, 6-arg form otherwise) so the entry-gate
 * characterization pins stay green through the cutover.
 *
 * Becomes `engine.highlights` when the ReaderEngine port lands (it is
 * constructed around the rendition either way); `count(layer)` feeds the
 * `__versicleTest.reader.highlightCount` E2E handle.
 */
import { createLogger } from '@lib/logger';
import {
  HIGHLIGHT_LAYERS,
  type HighlightLayerId,
} from './highlightStyles';

const logger = createLogger('HighlightLayerManager');

/**
 * Structural slice of the epub.js Rendition the manager drives. The ambient
 * epubjs stub does not type `annotations`/`views` (their retirement is the
 * Phase 6 stub-refactor item), so the manager owns the narrow contract.
 */
export interface AnnotatingRendition {
  annotations: {
    add(
      type: 'highlight',
      cfiRange: string,
      data: object,
      cb: ((e: Event) => void) | null | undefined,
      className: string,
      styles?: Record<string, string>,
    ): void;
    remove(cfiRange: string, type: 'highlight'): void;
  };
  views?: () => Array<{ pane?: { element?: Element } }> | undefined;
}

export interface AddHighlightOptions {
  /** epub.js class; defaults to the layer's registry class. */
  className?: string;
  /**
   * SVG attribute payload for epub.js (6-arg call form). Omitted → the
   * layer's registry default; explicitly `undefined` default → 5-arg form.
   */
  styles?: Record<string, string>;
  /**
   * Click handler attached to the SVG group. `null` is passed through to
   * epub.js verbatim (some legacy call sites pass an explicit null cb).
   */
  onClick?: ((e: Event) => void) | null;
  /** epub.js data bag (rarely used; defaults to {}). */
  data?: object;
}

interface HighlightHandle {
  className: string;
}

export class HighlightLayerManager {
  private readonly layers = new Map<HighlightLayerId, Map<string, HighlightHandle>>();

  constructor(private readonly rendition: AnnotatingRendition) {}

  /**
   * Adds a highlight to a layer. Idempotent per (layer, cfi): re-adding an
   * existing range is a no-op. Sweep layers purge orphaned SVG nodes first.
   */
  add(layer: HighlightLayerId, cfi: string, opts: AddHighlightOptions = {}): void {
    const config = HIGHLIGHT_LAYERS[layer];
    const entries = this.layerMap(layer);
    if (entries.has(cfi)) return;

    if (config.sweepOrphans) {
      this.sweepOrphans(layer);
    }

    const className = opts.className ?? config.defaultClassName;
    const styles = 'styles' in opts ? opts.styles : config.defaultStyles;
    try {
      if (styles !== undefined) {
        this.rendition.annotations.add('highlight', cfi, opts.data ?? {}, opts.onClick, className, styles);
      } else {
        this.rendition.annotations.add('highlight', cfi, opts.data ?? {}, opts.onClick, className);
      }
      entries.set(cfi, { className });
    } catch (e) {
      logger.warn(`Failed to add ${layer} highlight`, e);
    }
  }

  /** Removes a highlight from a layer (sweeping orphans for sweep layers). */
  remove(layer: HighlightLayerId, cfi: string): void {
    const config = HIGHLIGHT_LAYERS[layer];
    const entries = this.layerMap(layer);
    try {
      this.rendition.annotations.remove(cfi, 'highlight');
    } catch (e) {
      logger.warn(`Failed to remove ${layer} highlight`, e);
    }
    entries.delete(cfi);
    if (config.sweepOrphans) {
      this.sweepOrphans(layer);
    }
  }

  /** Removes every highlight in a layer. */
  clear(layer: HighlightLayerId): void {
    for (const cfi of Array.from(this.layerMap(layer).keys())) {
      this.remove(layer, cfi);
    }
  }

  /** Whether a (layer, cfi) highlight is currently tracked. */
  has(layer: HighlightLayerId, cfi: string): boolean {
    return this.layerMap(layer).has(cfi);
  }

  /** Tracked highlight count for a layer (the E2E test-handle feed). */
  count(layer: HighlightLayerId): number {
    return this.layerMap(layer).size;
  }

  /** Tracked CFIs for a layer (diff-effect bookkeeping). */
  cfis(layer: HighlightLayerId): string[] {
    return Array.from(this.layerMap(layer).keys());
  }

  /**
   * Manual DOM sweep killing orphaned SVG highlight groups. epub.js
   * occasionally orphans nested SVG annotations if inject() runs multiple
   * times or visibility races occur (ReaderTTSController provenance) — the
   * ONE implementation of the formerly-triplicated sweep.
   */
  sweepOrphans(layer: HighlightLayerId): void {
    const config = HIGHLIGHT_LAYERS[layer];
    const sweepClass = config.sweepClassName ?? config.defaultClassName;
    try {
      const views = this.rendition.views?.();
      if (views) {
        views.forEach((view) => {
          if (view.pane && view.pane.element) {
            const orphaned = view.pane.element.querySelectorAll(`g.${sweepClass}`);
            orphaned.forEach((node: Element) => node.remove());
          }
        });
      }
    } catch (e) {
      logger.warn(`Manual DOM cleanup failed (${layer})`, e);
    }
  }

  /**
   * Drops all bookkeeping WITHOUT touching the DOM — for rendition teardown
   * (epub.js destroys its panes; removing per-cfi would throw).
   */
  detach(): void {
    this.layers.clear();
  }

  private layerMap(layer: HighlightLayerId): Map<string, HighlightHandle> {
    let entries = this.layers.get(layer);
    if (!entries) {
      entries = new Map();
      this.layers.set(layer, entries);
    }
    return entries;
  }
}
