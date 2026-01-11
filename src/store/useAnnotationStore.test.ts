import { renderHook, act } from '@testing-library/react';
import { useAnnotationStore } from './useAnnotationStore';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock UUID for consistent IDs
vi.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));

describe('useAnnotationStore', () => {
  beforeEach(() => {
    // Reset store state
    act(() => {
      useAnnotationStore.setState({ annotations: {} });
    });
    vi.clearAllMocks();
  });

  it('should add annotation', () => {
    const { result } = renderHook(() => useAnnotationStore());
    const newAnnotation = { bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow' };

    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result.current.addAnnotation(newAnnotation as any);
    });

    const annotations = result.current.annotations;
    const ids = Object.keys(annotations);
    expect(ids).toHaveLength(1);
    expect(annotations[ids[0]]).toEqual(expect.objectContaining({
      id: 'test-uuid',
      bookId: 'book1',
      cfiRange: 'cfi',
      text: 'text',
      type: 'highlight',
      color: 'yellow',
    }));
  });

  it('should delete annotation', () => {
    const { result } = renderHook(() => useAnnotationStore());
    const annotation = { id: 'test-uuid', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 };

    act(() => {
      useAnnotationStore.setState({ annotations: { 'test-uuid': annotation as any } });
    });

    expect(result.current.annotations['test-uuid']).toBeDefined();

    act(() => {
      result.current.deleteAnnotation('test-uuid');
    });

    expect(result.current.annotations['test-uuid']).toBeUndefined();
    expect(Object.keys(result.current.annotations)).toHaveLength(0);
  });

  it('should update annotation', () => {
    const { result } = renderHook(() => useAnnotationStore());
    const annotation = { id: 'test-uuid', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 };

    act(() => {
      useAnnotationStore.setState({ annotations: { 'test-uuid': annotation as any } });
    });

    act(() => {
      result.current.updateAnnotation('test-uuid', { text: 'new note' });
    });

    expect(result.current.annotations['test-uuid'].text).toBe('new note');
    expect(result.current.annotations['test-uuid'].color).toBe('yellow'); // unchanged
  });
});
