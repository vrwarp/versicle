import { renderHook, act } from '@testing-library/react';
import { useAnnotationStore } from './useAnnotationStore';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDB } from '../db/db';

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

  beforeEach(() => {
    useAnnotationStore.setState({ annotations: [], popover: { visible: false, x: 0, y: 0, cfiRange: '', text: '' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getDB as any).mockResolvedValue(mockDB);
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
    const annotations = [{ id: '1', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 }];
    mockDB.getAllFromIndex.mockResolvedValue(annotations);

    await act(async () => {
      await result.current.loadAnnotations('book1');
    });

    expect(mockDB.getAllFromIndex).toHaveBeenCalledWith('annotations', 'by_bookId', 'book1');
    expect(result.current.annotations).toEqual(annotations);
  });

  it('should add annotation', async () => {
    const { result } = renderHook(() => useAnnotationStore());
    const newAnnotation = { bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow' };

    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await result.current.addAnnotation(newAnnotation as any);
    });

    expect(mockDB.add).toHaveBeenCalledWith('annotations', expect.objectContaining({
      id: 'test-uuid',
      bookId: 'book1',
      cfiRange: 'cfi',
      text: 'text',
      type: 'highlight',
      color: 'yellow',
    }));
    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.annotations[0].id).toBe('test-uuid');
  });

  it('should delete annotation', async () => {
    const { result } = renderHook(() => useAnnotationStore());
    const annotation = { id: 'test-uuid', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useAnnotationStore.setState({ annotations: [annotation as any] });

    await act(async () => {
      await result.current.deleteAnnotation('test-uuid');
    });

    expect(mockDB.delete).toHaveBeenCalledWith('annotations', 'test-uuid');
    expect(result.current.annotations).toHaveLength(0);
  });

  it('should update annotation', async () => {
    const { result } = renderHook(() => useAnnotationStore());
    const annotation = { id: 'test-uuid', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useAnnotationStore.setState({ annotations: [annotation as any] });
    mockDB.get.mockResolvedValue(annotation);

    await act(async () => {
      await result.current.updateAnnotation('test-uuid', { note: 'new note' });
    });

    expect(mockDB.put).toHaveBeenCalledWith('annotations', expect.objectContaining({
      id: 'test-uuid',
      note: 'new note',
    }));
    expect(result.current.annotations[0].note).toBe('new note');
  });
});
