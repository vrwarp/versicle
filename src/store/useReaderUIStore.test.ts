import { act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useReaderUIStore } from './useReaderUIStore';
import type { Annotation } from '~types/user-data';

const bookmark: Annotation = {
  id: 'bookmark-1',
  type: 'audio-bookmark',
  bookId: 'book-1',
  cfiRange: 'epubcfi(/6/4!/4/2)',
  text: 'bookmarked block',
  color: 'yellow',
  created: 0,
};

describe('useReaderUIStore', () => {
  beforeEach(() => {
    act(() => {
      useReaderUIStore.getState().reset();
    });
  });

  // The compass interaction state is ephemeral, device-local UI state. It
  // deliberately lives in this non-synced, non-persisted store (popover-desync
  // hotfix): its selection payload previously lived in the Yjs-wrapped
  // useAnnotationStore and synced screen coordinates to other devices.
  describe('compass dispatch', () => {
    it('enters annotation mode with the selection payload on TEXT_SELECTED', () => {
      act(() => {
        useReaderUIStore.getState().dispatchCompass({
          type: 'TEXT_SELECTED',
          selection: { x: 100, y: 200, cfiRange: 'cfi', text: 'selected text' },
        });
      });

      expect(useReaderUIStore.getState().compass).toEqual({
        mode: 'annotation',
        selection: { x: 100, y: 200, cfiRange: 'cfi', text: 'selected text' },
      });
    });

    it('tracks the annotation id when opened on an existing annotation', () => {
      act(() => {
        useReaderUIStore.getState().dispatchCompass({
          type: 'ANNOTATION_TAPPED',
          annotation: { ...bookmark, id: 'annotation-1' },
          x: 10,
          y: 20,
        });
      });

      const compass = useReaderUIStore.getState().compass;
      expect(compass.mode).toBe('annotation');
      expect(compass.mode === 'annotation' && compass.selection.annotationId).toBe('annotation-1');
    });

    it('returns to idle on DISMISSED', () => {
      act(() => {
        useReaderUIStore.getState().dispatchCompass({
          type: 'TEXT_SELECTED',
          selection: { x: 100, y: 200, cfiRange: 'cfi', text: 'selected text' },
        });
        useReaderUIStore.getState().dispatchCompass({ type: 'DISMISSED' });
      });

      expect(useReaderUIStore.getState().compass).toEqual({ mode: 'idle' });
    });

    it('ignores TEXT_SELECTED while audio-triage owns the selection', () => {
      act(() => {
        useReaderUIStore.getState().dispatchCompass({
          type: 'AUDIO_BOOKMARK_TAPPED',
          annotation: bookmark,
        });
        // The triage flow programmatically selects the bookmarked block; the
        // debounced selection emit must not morph the pill into the toolbar.
        useReaderUIStore.getState().dispatchCompass({
          type: 'TEXT_SELECTED',
          selection: { x: 0, y: 0, cfiRange: 'cfi', text: 'refined selection' },
        });
      });

      expect(useReaderUIStore.getState().compass).toEqual({
        mode: 'audio-triage',
        annotation: bookmark,
      });
    });

    it('reset() restores the idle interaction state', () => {
      act(() => {
        useReaderUIStore.getState().dispatchCompass({
          type: 'TEXT_SELECTED',
          selection: { x: 100, y: 200, cfiRange: 'cfi', text: 'selected text' },
        });
        useReaderUIStore.getState().reset();
      });

      expect(useReaderUIStore.getState().compass).toEqual({ mode: 'idle' });
    });
  });
});
