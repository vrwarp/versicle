import { renderHook, act, waitFor } from '@testing-library/react';
import { useAnnotationStore } from './useAnnotationStore';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDB } from '../db/db';
import { crdtService } from '../lib/crdt/CRDTService';

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

    // Ensure all DB methods return promises
    mockDB.getAllFromIndex.mockResolvedValue([]);
    mockDB.add.mockResolvedValue(undefined);
    mockDB.delete.mockResolvedValue(undefined);
    mockDB.get.mockResolvedValue(undefined);
    mockDB.put.mockResolvedValue(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getDB as any).mockResolvedValue(mockDB);

    // Clear CRDT
    crdtService.doc.transact(() => {
        crdtService.annotations.clear();
    });

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

  it('should load annotations from CRDT', async () => {
    const { result } = renderHook(() => useAnnotationStore());
    const annotations = [{ id: '1', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 }];

    // Populate CRDT
    crdtService.doc.transact(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        crdtService.annotations.set('1', annotations[0] as any);
    });

    await act(async () => {
      await result.current.loadAnnotations('book1');
    });

    expect(result.current.annotations).toEqual(annotations);
  });

  it('should add annotation (dual-write)', async () => {
    const { result } = renderHook(() => useAnnotationStore());
    const newAnnotation = { bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow' };

    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await result.current.addAnnotation(newAnnotation as any);
    });

    // Check DB write
    expect(mockDB.add).toHaveBeenCalledWith('annotations', expect.objectContaining({
      id: 'test-uuid',
      bookId: 'book1',
      cfiRange: 'cfi',
      text: 'text',
      type: 'highlight',
      color: 'yellow',
    }));

    // Check CRDT write
    expect(crdtService.annotations.has('test-uuid')).toBe(true);

    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.annotations[0].id).toBe('test-uuid');
  });

  it('should delete annotation (dual-delete)', async () => {
    const { result } = renderHook(() => useAnnotationStore());
    const annotation = { id: 'test-uuid', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 };

    // Populate store
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useAnnotationStore.setState({ annotations: [annotation as any] });
    // Populate CRDT
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    crdtService.annotations.set('test-uuid', annotation as any);

    await act(async () => {
      await result.current.deleteAnnotation('test-uuid');
    });

    await waitFor(() => {
        expect(mockDB.delete).toHaveBeenCalledWith('annotations', 'test-uuid');
    });
    expect(crdtService.annotations.has('test-uuid')).toBe(false);
    expect(result.current.annotations).toHaveLength(0);
  });

  it('should update annotation (dual-update)', async () => {
    const { result } = renderHook(() => useAnnotationStore());
    const annotation = { id: 'test-uuid', bookId: 'book1', cfiRange: 'cfi', text: 'text', type: 'highlight', color: 'yellow', created: 123 };

    // Populate store
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useAnnotationStore.setState({ annotations: [annotation as any] });
    // Populate CRDT
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    crdtService.annotations.set('test-uuid', annotation as any);

    mockDB.get.mockResolvedValue(annotation);

    await act(async () => {
      await result.current.updateAnnotation('test-uuid', { note: 'new note' });
    });

    await waitFor(() => {
        expect(mockDB.put).toHaveBeenCalledWith('annotations', expect.objectContaining({
            id: 'test-uuid',
            note: 'new note',
        }));
    });

    const crdtAnnotation = crdtService.annotations.get('test-uuid');
    expect(crdtAnnotation?.note).toBe('new note');

    expect(result.current.annotations[0].note).toBe('new note');
  });
});
