import { describe, it, expect } from 'vitest';
import {
  COMPASS_IDLE,
  compassOwnsSelection,
  deriveAmbientVariant,
  resolvePillVariant,
  transitionCompass,
  type CompassAmbient,
  type CompassEvent,
  type CompassInteraction,
  type CompassSelection,
} from './compassMachine';
import type { Annotation } from '~types/user-data';

const selection: CompassSelection = {
  cfiRange: 'epubcfi(/6/4!/4/2)',
  text: 'selected text',
  x: 10,
  y: 20,
};

const highlight: Annotation = {
  id: 'highlight-1',
  bookId: 'book-1',
  cfiRange: 'epubcfi(/6/4!/4/4)',
  text: 'highlighted text',
  type: 'highlight',
  color: 'yellow',
  created: 0,
};

const bookmark: Annotation = {
  ...highlight,
  id: 'bookmark-1',
  type: 'audio-bookmark',
};

const ANNOTATION: CompassInteraction = { mode: 'annotation', selection };
const VOCAB: CompassInteraction = { mode: 'vocab-triage', selection };
const TRIAGE: CompassInteraction = { mode: 'audio-triage', annotation: bookmark };
const ALL_STATES: CompassInteraction[] = [COMPASS_IDLE, ANNOTATION, VOCAB, TRIAGE];

describe('transitionCompass', () => {
  describe('TEXT_SELECTED', () => {
    it.each([COMPASS_IDLE, ANNOTATION, VOCAB])(
      'opens the annotation toolbar with the fresh selection from %j',
      (from) => {
        const fresh: CompassSelection = { ...selection, text: 'fresh selection' };
        expect(transitionCompass(from, { type: 'TEXT_SELECTED', selection: fresh })).toEqual({
          mode: 'annotation',
          selection: fresh,
        });
      },
    );

    it('is ignored while audio-triage owns the live selection (refinement guard)', () => {
      // Entering triage programmatically selects the bookmarked block and the
      // user may refine it by hand — neither is a "new annotation" gesture.
      expect(transitionCompass(TRIAGE, { type: 'TEXT_SELECTED', selection })).toBe(TRIAGE);
    });

    it('replaces a tapped annotation atomically (no stale annotationId survives)', () => {
      const onAnnotation = transitionCompass(COMPASS_IDLE, {
        type: 'ANNOTATION_TAPPED',
        annotation: highlight,
        x: 1,
        y: 2,
      });
      const next = transitionCompass(onAnnotation, { type: 'TEXT_SELECTED', selection });
      expect(next).toEqual({ mode: 'annotation', selection });
    });
  });

  describe('ANNOTATION_TAPPED', () => {
    it.each(ALL_STATES)('opens the toolbar on the tapped annotation from %j', (from) => {
      expect(
        transitionCompass(from, { type: 'ANNOTATION_TAPPED', annotation: highlight, x: 1, y: 2 }),
      ).toEqual({
        mode: 'annotation',
        selection: {
          cfiRange: highlight.cfiRange,
          text: highlight.text,
          x: 1,
          y: 2,
          annotationId: highlight.id,
        },
        annotation: highlight,
      });
    });
  });

  describe('AUDIO_BOOKMARK_TAPPED', () => {
    it.each(ALL_STATES)('enters triage carrying the bookmark from %j', (from) => {
      expect(
        transitionCompass(from, { type: 'AUDIO_BOOKMARK_TAPPED', annotation: bookmark }),
      ).toEqual(TRIAGE);
    });
  });

  describe('VOCAB_TRIAGE_REQUESTED', () => {
    it('carries the annotation selection into the vocab card', () => {
      expect(transitionCompass(ANNOTATION, { type: 'VOCAB_TRIAGE_REQUESTED' })).toEqual(VOCAB);
    });

    it.each([COMPASS_IDLE, VOCAB, TRIAGE])(
      'is ignored without an annotation toolbar to depart from (%j)',
      (from) => {
        // Vocab triage refines a live selection — without one there is no
        // text for the card, so the event does not apply.
        expect(transitionCompass(from, { type: 'VOCAB_TRIAGE_REQUESTED' })).toBe(from);
      },
    );
  });

  describe('exits', () => {
    const exits: CompassEvent[] = [
      { type: 'ACTION_COMMITTED' },
      { type: 'DISMISSED' },
      { type: 'OUTSIDE_TAP' },
      { type: 'CONTEXT_INVALIDATED' },
    ];

    it.each(exits)('$type returns every mode to idle', (event) => {
      for (const from of ALL_STATES) {
        expect(transitionCompass(from, event).mode).toBe('idle');
      }
    });

    it('returns the same reference when already idle (no-op detection)', () => {
      for (const event of exits) {
        expect(transitionCompass(COMPASS_IDLE, event)).toBe(COMPASS_IDLE);
      }
    });
  });
});

describe('compassOwnsSelection', () => {
  it('is true exactly for the modes operating on a live user selection', () => {
    expect(compassOwnsSelection(COMPASS_IDLE)).toBe(false);
    expect(compassOwnsSelection(ANNOTATION)).toBe(true);
    expect(compassOwnsSelection(VOCAB)).toBe(true);
    // audio-triage manages its own programmatic selection via the engine.
    expect(compassOwnsSelection(TRIAGE)).toBe(false);
  });
});

describe('ambient derivation and variant resolution', () => {
  const ambient = (overrides: Partial<CompassAmbient> = {}): CompassAmbient => ({
    showSyncAlert: false,
    isReaderActive: false,
    immersiveMode: false,
    isAudioPlaying: false,
    hasLastReadBook: false,
    hasQueueItems: false,
    ...overrides,
  });

  it('derives nothing when nothing is happening', () => {
    expect(deriveAmbientVariant(ambient())).toBeNull();
  });

  it('ranks sync-alert above the open reader', () => {
    expect(deriveAmbientVariant(ambient({ showSyncAlert: true, isReaderActive: true }))).toBe(
      'sync-alert',
    );
  });

  it('shows the active pill in the reader, compact when immersive', () => {
    expect(deriveAmbientVariant(ambient({ isReaderActive: true }))).toBe('active');
    expect(deriveAmbientVariant(ambient({ isReaderActive: true, immersiveMode: true }))).toBe(
      'compact',
    );
  });

  it('keeps the active pill while audio plays outside the reader', () => {
    expect(deriveAmbientVariant(ambient({ isAudioPlaying: true }))).toBe('active');
  });

  it('prefers the summary over a paused queue on the home surface', () => {
    expect(deriveAmbientVariant(ambient({ hasLastReadBook: true, hasQueueItems: true }))).toBe(
      'summary',
    );
    expect(deriveAmbientVariant(ambient({ hasQueueItems: true }))).toBe('active');
  });

  it('a live interaction always outranks ambient state — even the sync alert', () => {
    const noisy = ambient({ showSyncAlert: true, isReaderActive: true });
    expect(resolvePillVariant(ANNOTATION, noisy)).toBe('annotation');
    expect(resolvePillVariant(VOCAB, noisy)).toBe('vocab-triage');
    expect(resolvePillVariant(TRIAGE, noisy)).toBe('audio-triage');
    expect(resolvePillVariant(COMPASS_IDLE, noisy)).toBe('sync-alert');
  });
});
