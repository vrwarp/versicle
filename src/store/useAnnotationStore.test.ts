import { renderHook, act } from '@testing-library/react';
import { createAnnotationStore } from './useAnnotationStore';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/db', () => ({
  getDB: vi.fn(),
}));

vi.mock('uuid', () => ({
  v4: () => 'test-uuid',
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

    useAnnotationStore = createAnnotationStore(async () => mockDB);
    useAnnotationStore.setState({ annotations: [], popover: { visible: false, x: 0, y: 0, cfiRange: '', text: '' } });

    vi.clearAllMocks();
  });

  it('should show and hide popover', () => {
    const { result } = renderHook(() => useAnnotationStore());

    act(() => {
      result.current.showPopover(100, 200, 'cfi', 'selected text');
    });

    expect(result.current.popover).toEqual({
      visible: true,
      x: 100,
      y: 200,
      cfiRange: 'cfi',
      text: 'selected text',
    });

    act(() => {
      result.current.hidePopover();
    });

    expect(result.current.popover.visible).toBe(false);
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
});
