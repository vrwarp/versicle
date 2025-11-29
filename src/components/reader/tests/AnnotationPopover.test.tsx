import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnnotationPopover } from '../AnnotationPopover';
import { useAnnotationStore } from '../../../store/useAnnotationStore';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Copy: () => <span data-testid="icon-copy" />,
  Highlighter: () => <span data-testid="icon-highlighter" />,
  StickyNote: () => <span data-testid="icon-note" />,
  X: () => <span data-testid="icon-close" />,
}));

describe('AnnotationPopover', () => {
  beforeEach(() => {
    useAnnotationStore.setState({
      popover: { visible: false, x: 0, y: 0, cfiRange: '', text: '' },
      annotations: [],
    });
    vi.clearAllMocks();
  });

  it('should render nothing when not visible', () => {
    render(<AnnotationPopover bookId="book1" onClose={vi.fn()} />);
    expect(screen.queryByTestId('icon-close')).toBeNull();
  });

  it('should render when visible', () => {
    useAnnotationStore.setState({
      popover: { visible: true, x: 100, y: 100, cfiRange: 'cfi', text: 'text' },
    });

    render(<AnnotationPopover bookId="book1" onClose={vi.fn()} />);
    expect(screen.getByTestId('icon-close')).toBeInTheDocument();
    expect(screen.getByTitle('Yellow')).toBeInTheDocument();
    expect(screen.getByTitle('Green')).toBeInTheDocument();
    expect(screen.getByTitle('Blue')).toBeInTheDocument();
    expect(screen.getByTitle('Red')).toBeInTheDocument();
  });

  it('should add annotation on color click', async () => {
    const addAnnotationMock = vi.fn();
    useAnnotationStore.setState({
      popover: { visible: true, x: 100, y: 100, cfiRange: 'cfi', text: 'text' },
      addAnnotation: addAnnotationMock,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const onCloseMock = vi.fn();
    render(<AnnotationPopover bookId="book1" onClose={onCloseMock} />);

    fireEvent.click(screen.getByTitle('Yellow'));

    await waitFor(() => {
      expect(addAnnotationMock).toHaveBeenCalledWith(expect.objectContaining({
        bookId: 'book1',
        cfiRange: 'cfi',
        text: 'text',
        type: 'highlight',
        color: 'yellow',
      }));
      expect(onCloseMock).toHaveBeenCalled();
    });
  });

  it('should close on close button click', () => {
     useAnnotationStore.setState({
      popover: { visible: true, x: 100, y: 100, cfiRange: 'cfi', text: 'text' },
    });

    render(<AnnotationPopover bookId="book1" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Close'));

    expect(useAnnotationStore.getState().popover.visible).toBe(false);
  });
});
