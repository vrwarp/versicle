import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotationList } from '../AnnotationList';
import { useAnnotationStore } from '../../../store/useAnnotationStore';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('lucide-react', () => ({
  Trash2: () => <span data-testid="icon-trash" />,
  StickyNote: () => <span data-testid="icon-note" />,
  PenLine: () => <span data-testid="icon-edit" />,
}));

describe('AnnotationList', () => {
  beforeEach(() => {
    useAnnotationStore.setState({ annotations: [] });
    vi.clearAllMocks();
  });

  it('should render empty state', () => {
    render(<AnnotationList onNavigate={vi.fn()} />);
    expect(screen.getByText(/No annotations yet/i)).toBeInTheDocument();
  });

  it('should render annotations', () => {
    const annotations = [
      { id: '1', bookId: 'b1', cfiRange: 'cfi1', text: 'Annotation 1', type: 'highlight', color: 'yellow', created: Date.now() },
      { id: '2', bookId: 'b1', cfiRange: 'cfi2', text: 'Annotation 2', type: 'note', color: 'green', note: 'My Note', created: Date.now() },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useAnnotationStore.setState({ annotations: annotations as any });

    render(<AnnotationList onNavigate={vi.fn()} />);

    expect(screen.getByText('Annotation 1')).toBeInTheDocument();
    expect(screen.getByText('Annotation 2')).toBeInTheDocument();
    expect(screen.getByText('My Note')).toBeInTheDocument();
  });

  it('should navigate on click', () => {
    const onNavigateMock = vi.fn();
    const annotations = [
      { id: '1', bookId: 'b1', cfiRange: 'cfi1', text: 'Annotation 1', type: 'highlight', color: 'yellow', created: Date.now() },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useAnnotationStore.setState({ annotations: annotations as any });

    render(<AnnotationList onNavigate={onNavigateMock} />);

    fireEvent.click(screen.getByText('Annotation 1'));
    expect(onNavigateMock).toHaveBeenCalledWith('cfi1');
  });

  it('should delete annotation', () => {
    const deleteAnnotationMock = vi.fn();
    const annotations = [
      { id: '1', bookId: 'b1', cfiRange: 'cfi1', text: 'Annotation 1', type: 'highlight', color: 'yellow', created: Date.now() },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useAnnotationStore.setState({ annotations: annotations as any, deleteAnnotation: deleteAnnotationMock });
    window.confirm = vi.fn(() => true);

    render(<AnnotationList onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Delete'));
    expect(deleteAnnotationMock).toHaveBeenCalledWith('1');
  });

  it('should edit note', () => {
    const updateAnnotationMock = vi.fn();
    const annotations = [
      { id: '1', bookId: 'b1', cfiRange: 'cfi1', text: 'Annotation 1', type: 'highlight', color: 'yellow', created: Date.now() },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useAnnotationStore.setState({ annotations: annotations as any, updateAnnotation: updateAnnotationMock });

    render(<AnnotationList onNavigate={vi.fn()} />);

    // Click edit button to show input
    fireEvent.click(screen.getByTitle('Edit Note'));

    // Find input and type
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'New Note' } });

    // Click save
    fireEvent.click(screen.getByText('Save'));

    expect(updateAnnotationMock).toHaveBeenCalledWith('1', { note: 'New Note' });
  });
});
