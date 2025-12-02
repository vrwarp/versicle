import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { Dialog } from './Dialog';
import { describe, it, expect, vi } from 'vitest';

describe('Dialog', () => {
  it('does not render when not open', () => {
    render(
      <Dialog
        isOpen={false}
        onClose={() => {}}
        title="Test Title"
      />
    );
    expect(screen.queryByText('Test Title')).toBeNull();
  });

  it('renders title and description when open', () => {
    render(
      <Dialog
        isOpen={true}
        onClose={() => {}}
        title="Test Title"
        description="Test Description"
      />
    );
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test Description')).toBeInTheDocument();
  });

  it('renders children content', () => {
    render(
      <Dialog isOpen={true} onClose={() => {}} title="Test Title">
        <div data-testid="dialog-content">Content</div>
      </Dialog>
    );
    expect(screen.getByTestId('dialog-content')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen={true} onClose={onClose} title="Test Title" />
    );
    const closeButton = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders footer', () => {
    render(
      <Dialog
        isOpen={true}
        onClose={() => {}}
        title="Test Title"
        footer={<button>Action</button>}
      />
    );
    expect(screen.getByText('Action')).toBeInTheDocument();
  });
});
