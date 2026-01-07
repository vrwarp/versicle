import { renderHook, act } from '@testing-library/react';
import { useAnnotationStore } from './useAnnotationStore';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dbService } from '../db/DBService';
import type { Annotation } from '../types/db';

vi.mock('../db/DBService', () => ({
  dbService: {
    getAnnotations: vi.fn(),
    addAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    updateAnnotation: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));

describe('useAnnotationStore', () => {
  beforeEach(() => {
    useAnnotationStore.setState({ annotations: [], popover: { visible: false, x: 0, y: 0, cfiRange: '', text: '' } });

    vi.mocked(dbService.getAnnotations).mockResolvedValue([]);
    vi.mocked(dbService.addAnnotation).mockResolvedValue(undefined);
    vi.mocked(dbService.deleteAnnotation).mockResolvedValue(undefined);
    vi.mocked(dbService.updateAnnotation).mockResolvedValue(undefined);

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
    const annotations: Annotation[] = [{ id: '1', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 }];
    vi.mocked(dbService.getAnnotations).mockResolvedValue(annotations);

    await act(async () => {
      await result.current.loadAnnotations('book1');
    });

    expect(dbService.getAnnotations).toHaveBeenCalledWith('book1');
    expect(result.current.annotations).toEqual(annotations);
  });

  it('should add annotation', async () => {
    const { result } = renderHook(() => useAnnotationStore());
    const newAnnotation = { bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow' };

    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await result.current.addAnnotation(newAnnotation as any);
    });

    expect(dbService.addAnnotation).toHaveBeenCalledWith(expect.objectContaining({
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
    const annotation: Annotation = { id: 'test-uuid', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 };
    useAnnotationStore.setState({ annotations: [annotation] });

    await act(async () => {
      await result.current.deleteAnnotation('test-uuid');
    });

    expect(dbService.deleteAnnotation).toHaveBeenCalledWith('test-uuid');
    expect(result.current.annotations).toHaveLength(0);
  });

  it('should update annotation', async () => {
    const { result } = renderHook(() => useAnnotationStore());
    const annotation: Annotation = { id: 'test-uuid', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 };
    useAnnotationStore.setState({ annotations: [annotation] });

    await act(async () => {
      await result.current.updateAnnotation('test-uuid', { note: 'new note' });
    });

    expect(dbService.updateAnnotation).toHaveBeenCalledWith('test-uuid', { note: 'new note' });
    expect(result.current.annotations[0].note).toBe('new note');
  });
});
