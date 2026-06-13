import { act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useReaderUIStore } from './useReaderUIStore';

describe('useReaderUIStore', () => {
  beforeEach(() => {
    act(() => {
      useReaderUIStore.getState().reset();
    });
  });

  // The annotation popover is ephemeral, device-local UI state. It deliberately
  // lives in this non-synced, non-persisted store (popover-desync hotfix): it
  // previously lived in the Yjs-wrapped useAnnotationStore and synced screen
  // coordinates to other devices.
  describe('annotation popover', () => {
    it('shows the popover with coordinates and selection', () => {
      act(() => {
        useReaderUIStore.getState().showPopover(100, 200, 'cfi', 'selected text');
      });

      expect(useReaderUIStore.getState().popover).toEqual({
        visible: true,
        x: 100,
        y: 200,
        cfiRange: 'cfi',
        text: 'selected text',
        id: undefined,
      });
    });

    it('tracks the annotation id when opened on an existing annotation', () => {
      act(() => {
        useReaderUIStore.getState().showPopover(10, 20, 'cfi-2', 'text', 'annotation-1');
      });

      expect(useReaderUIStore.getState().popover.id).toBe('annotation-1');
    });

    it('hides the popover and clears the annotation id', () => {
      act(() => {
        useReaderUIStore.getState().showPopover(100, 200, 'cfi', 'selected text', 'annotation-1');
        useReaderUIStore.getState().hidePopover();
      });

      const { popover } = useReaderUIStore.getState();
      expect(popover.visible).toBe(false);
      expect(popover.id).toBeUndefined();
    });

    it('reset() restores the initial popover state', () => {
      act(() => {
        useReaderUIStore.getState().showPopover(100, 200, 'cfi', 'selected text');
        useReaderUIStore.getState().reset();
      });

      expect(useReaderUIStore.getState().popover).toEqual({
        visible: false,
        x: 0,
        y: 0,
        cfiRange: '',
        text: '',
      });
    });
  });
});
