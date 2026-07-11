import type { Annotation } from '~types/user-data';

/**
 * compassMachine — the explicit state-transition model for the compass pill
 * (the ReaderControlBar variant router).
 *
 * Before this module, the rendered pill variant emerged from three overlapping
 * sources of truth: an imperative `compassState.variant` override written from
 * eight call sites, a separate `popover.visible` boolean that implied the
 * annotation toolbar, and the ambient reader conditions. Which variant showed
 * depended on the ORDER those writers fired in ("reset before showPopover on
 * every fresh gesture") and on how a mode was entered (acting on a
 * highlight-tap left a stale 'annotation' override behind; a triage variant
 * without its payload rendered nothing at all).
 *
 * The model here splits the decision into two layers:
 *
 *  1. INTERACTION (this machine) — what the user is doing right now:
 *     `idle`, `annotation` (selection toolbar / note editor), `vocab-triage`
 *     (Chinese vocab card), or `audio-triage` (dragnet bookmark review).
 *     Each mode CARRIES its payload, so a mode without the data it needs is
 *     unrepresentable. Mutations go through `transitionCompass(state, event)`
 *     only — an event that is not meaningful in the current mode is ignored
 *     by the table instead of by ad-hoc guards at the call sites.
 *
 *  2. AMBIENT (`deriveAmbientVariant`) — what the surroundings imply when no
 *     interaction is in flight: sync-alert, active/compact audio pill,
 *     summary, or nothing.
 *
 * `resolvePillVariant` combines them with ONE rule: a live interaction always
 * outranks ambient state. (This also ends the old path-dependent ranking
 * where sync-alert beat a selection toolbar opened by selecting text but lost
 * to the same toolbar opened by tapping a highlight.)
 */

/** Selection payload carried by the selection-owning modes. */
export interface CompassSelection {
  cfiRange: string;
  text: string;
  /** Best-effort screen coordinates (kept for any future anchored UI). */
  x: number;
  y: number;
  /** Set when the selection came from tapping an existing annotation. */
  annotationId?: string;
}

export type CompassInteraction =
  | { mode: 'idle' }
  | { mode: 'annotation'; selection: CompassSelection; annotation?: Annotation }
  | { mode: 'vocab-triage'; selection: CompassSelection }
  | { mode: 'audio-triage'; annotation: Annotation };

export type CompassInteractionMode = CompassInteraction['mode'];

export type CompassEvent =
  /** The user selected text in the reader (selection bridge emit). */
  | { type: 'TEXT_SELECTED'; selection: CompassSelection }
  /** The user tapped an existing highlight or note marker. */
  | { type: 'ANNOTATION_TAPPED'; annotation: Annotation; x: number; y: number }
  /** The user tapped a pending dragnet audio bookmark. */
  | { type: 'AUDIO_BOOKMARK_TAPPED'; annotation: Annotation }
  /** The annotation toolbar's vocab button (Chinese selections only). */
  | { type: 'VOCAB_TRIAGE_REQUESTED' }
  /**
   * The current mode's work finished: a highlight/note was saved, text was
   * copied, playback/pronounce/delete ran, or a triage was confirmed or
   * discarded.
   */
  | { type: 'ACTION_COMMITTED' }
  /** The user explicitly closed the current pill (X buttons). */
  | { type: 'DISMISSED' }
  /** A tap landed outside the pill (shell chrome, collapsed iframe click). */
  | { type: 'OUTSIDE_TAP' }
  /**
   * The surrounding context changed under the interaction: a sidebar or
   * immersive mode opened, the book closed, or reader content is about to
   * re-render (Chinese script/pinyin settings).
   */
  | { type: 'CONTEXT_INVALIDATED' };

export const COMPASS_IDLE: CompassInteraction = { mode: 'idle' };

/**
 * The one transition function. Pure: same (state, event) in, same state out.
 * Returns the input state by reference when the event does not apply, so
 * callers (and zustand selectors) can cheaply detect "nothing happened".
 */
export function transitionCompass(
  state: CompassInteraction,
  event: CompassEvent,
): CompassInteraction {
  switch (event.type) {
    case 'TEXT_SELECTED':
      // Audio-bookmark triage OWNS the live selection: entering triage
      // programmatically selects the bookmarked block and the user may refine
      // that selection by hand before confirming. Neither is a "new
      // annotation" gesture, so it must not morph the triage pill into the
      // annotation toolbar. Everywhere else a fresh selection wins — it
      // atomically replaces whatever payload the previous mode carried.
      if (state.mode === 'audio-triage') return state;
      return { mode: 'annotation', selection: event.selection };

    case 'ANNOTATION_TAPPED':
      return {
        mode: 'annotation',
        selection: {
          cfiRange: event.annotation.cfiRange,
          text: event.annotation.text,
          x: event.x,
          y: event.y,
          annotationId: event.annotation.id,
        },
        annotation: event.annotation,
      };

    case 'AUDIO_BOOKMARK_TAPPED':
      return { mode: 'audio-triage', annotation: event.annotation };

    case 'VOCAB_TRIAGE_REQUESTED':
      // Vocab triage refines a live selection, so it is only reachable from
      // the annotation toolbar; the selection payload carries over.
      if (state.mode !== 'annotation') return state;
      return { mode: 'vocab-triage', selection: state.selection };

    case 'ACTION_COMMITTED':
    case 'DISMISSED':
    case 'OUTSIDE_TAP':
    case 'CONTEXT_INVALIDATED':
      // Every way out lands in the same place. In particular ACTION_COMMITTED
      // always returns to idle — under the old model, acting on a tapped
      // highlight (play/copy/delete/pronounce) cleared only the popover and
      // left the 'annotation' variant override stuck on screen.
      return state.mode === 'idle' ? state : COMPASS_IDLE;
  }
}

/**
 * True when the interaction mode owns a live text selection in the reader
 * iframe (the annotation toolbar and the vocab card both operate on one).
 * Leaving these modes is the signal to clear the engine selection.
 * `audio-triage` manages its own programmatic selection via the engine and
 * is deliberately NOT included (parity with the old popover.visible flag).
 */
export function compassOwnsSelection(
  state: CompassInteraction,
): state is Extract<CompassInteraction, { mode: 'annotation' | 'vocab-triage' }> {
  return state.mode === 'annotation' || state.mode === 'vocab-triage';
}

/** Everything the pill can render as. Interaction modes plus ambient ones. */
export type PillVariant =
  | Exclude<CompassInteractionMode, 'idle'>
  | 'sync-alert'
  | 'active'
  | 'compact'
  | 'summary';

/** Ambient reader conditions, in priority order of the fields below. */
export interface CompassAmbient {
  /** Un-dismissed remote progress from another device. */
  showSyncAlert: boolean;
  /** A book is open in the reader. */
  isReaderActive: boolean;
  immersiveMode: boolean;
  /** TTS is currently playing (audio can outlive the reader route). */
  isAudioPlaying: boolean;
  /** There is a last-read book to offer on the home surface. */
  hasLastReadBook: boolean;
  /** A paused TTS queue exists without a last-read book. */
  hasQueueItems: boolean;
}

/** What the pill shows when no interaction is in flight. */
export function deriveAmbientVariant(ambient: CompassAmbient): PillVariant | null {
  if (ambient.showSyncAlert) return 'sync-alert';
  if (ambient.isReaderActive) return ambient.immersiveMode ? 'compact' : 'active';
  if (ambient.isAudioPlaying) return 'active';
  if (ambient.hasLastReadBook) return 'summary';
  if (ambient.hasQueueItems) return 'active';
  return null;
}

/** The single routing rule: a live interaction always outranks ambient state. */
export function resolvePillVariant(
  interaction: CompassInteraction,
  ambient: CompassAmbient,
): PillVariant | null {
  if (interaction.mode !== 'idle') return interaction.mode;
  return deriveAmbientVariant(ambient);
}
