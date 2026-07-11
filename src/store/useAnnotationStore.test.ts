import { renderHook, act } from '@testing-library/react';
import { createAnnotationStore } from './useAnnotationStore';
import { useReaderUIStore } from './useReaderUIStore';
import { getYDoc } from './yjs-provider';

const yDoc = getYDoc();
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@lib/crypto', () => ({
  generateSecureId: vi.fn(() => 'test-uuid'),
}));

describe('useAnnotationStore', () => {
  const mockDB = {
    getAllFromIndex: vi.fn(),
    add: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
  };

  let useAnnotationStore: ReturnType<typeof createAnnotationStore>;

  beforeEach(() => {
    // Ensure all DB methods return promises
    mockDB.getAllFromIndex.mockResolvedValue([]);
    mockDB.add.mockResolvedValue(undefined);
    mockDB.delete.mockResolvedValue(undefined);
    mockDB.get.mockResolvedValue(undefined);
    mockDB.put.mockResolvedValue(undefined);

    useAnnotationStore = createAnnotationStore();
    useAnnotationStore.setState({ annotations: {} });

    vi.clearAllMocks();
  });

  it('should load annotations', async () => {
    const { result } = renderHook(() => useAnnotationStore());

    // With Yjs, loadAnnotations is a no-op. We simulate data arrival via Yjs sync (or setState).
    const annotationsMap = {
      '1': { id: '1', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 }
    };

    // Create expected array if the test checked for array, but here it checks equality of the map or object
    // The previous test expected 'annotations' to be equal to an array.
    // However, the STORE defines 'annotations' as Record<string, UserAnnotation>.
    // So we should expect it to equal the map.

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    act(() => useAnnotationStore.setState({ annotations: annotationsMap as any }));

    await act(async () => {
      await result.current.loadAnnotations('book1');
    });

    expect(result.current.annotations).toEqual(annotationsMap);
  });

  it('should add annotation', async () => {
    const { result } = renderHook(() => useAnnotationStore());
    const newAnnotation = { bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow' };

    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await result.current.add(newAnnotation as any);
    });

    const annotations = result.current.annotations;
    const ids = Object.keys(annotations);
    expect(ids).toHaveLength(1);
    expect(annotations[ids[0]]).toMatchObject({
      ...newAnnotation,
      id: expect.any(String),
      created: expect.any(Number)
    });
  });

  it('should delete annotation', async () => {
    const { result } = renderHook(() => useAnnotationStore());
    const annotation = { id: 'test-uuid', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 };

    // Manually set state directly as if loaded from Yjs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    act(() => useAnnotationStore.setState({ annotations: { 'test-uuid': annotation as any } }));

    await act(async () => {
      await result.current.remove('test-uuid');
    });

    const ids = Object.keys(result.current.annotations);
    expect(ids).toHaveLength(0);
  });

  it('should update annotation', async () => {
    const { result } = renderHook(() => useAnnotationStore());
    const annotation = { id: 'test-uuid', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    act(() => useAnnotationStore.setState({ annotations: { 'test-uuid': annotation as any } }));

    await act(async () => {
      await result.current.update('test-uuid', { note: 'new note' });
    });

    expect(result.current.annotations['test-uuid'].note).toBe('new note');
  });

  describe('regression: popover-desync — popover state is not synced through the CRDT', () => {
    // The yjs() middleware flushes outbound writes in a microtask; yield a macrotask
    // so any (erroneous) pending Y.Doc write would have fired before we assert.
    const flushYjsWrites = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    it('does not carry compass/popover state or actions on the annotation store', () => {
      const state = useAnnotationStore.getState();
      expect(state).not.toHaveProperty('popover');
      expect(state).not.toHaveProperty('showPopover');
      expect(state).not.toHaveProperty('hidePopover');
      expect(state).not.toHaveProperty('compass');
      expect(state).not.toHaveProperty('dispatchCompass');
    });

    it('compass open/close writes nothing to the Y.Doc and fires no annotations observer', async () => {
      // Let any writes scheduled by beforeEach setState settle first.
      await flushYjsWrites();

      const updateSpy = vi.fn();
      const observerSpy = vi.fn();
      const annotationsMap = yDoc.getMap('annotations');
      yDoc.on('update', updateSpy);
      annotationsMap.observeDeep(observerSpy);

      try {
        act(() => {
          useReaderUIStore.getState().dispatchCompass({
            type: 'TEXT_SELECTED',
            selection: { x: 100, y: 200, cfiRange: 'cfi', text: 'selected text' },
          });
        });
        await flushYjsWrites();

        expect(useReaderUIStore.getState().compass).toEqual({
          mode: 'annotation',
          selection: { x: 100, y: 200, cfiRange: 'cfi', text: 'selected text' },
        });

        act(() => {
          useReaderUIStore.getState().dispatchCompass({ type: 'DISMISSED' });
        });
        await flushYjsWrites();

        expect(useReaderUIStore.getState().compass.mode).toBe('idle');
        expect(updateSpy).not.toHaveBeenCalled();
        expect(observerSpy).not.toHaveBeenCalled();

        // Control: a real annotation write must still reach the Y.Doc,
        // proving the spies are wired to the live document.
        act(() => {
          useAnnotationStore.getState().add({
            bookId: 'book1',
            cfiRange: 'cfi',
            text: 'text',
            type: 'highlight',
            color: 'yellow',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
        });
        await flushYjsWrites();

        expect(updateSpy).toHaveBeenCalled();
      } finally {
        yDoc.off('update', updateSpy);
        annotationsMap.unobserveDeep(observerSpy);
      }
    });
  });
});
