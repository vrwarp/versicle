import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { Dialog } from './Dialog';
import { describe, it, expect, vi } from 'vitest';

// Mock Radix UI Primitives
vi.mock('@radix-ui/react-dialog', () => {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Root: ({ open, onOpenChange, children }: any) => {
            return open ? (
                <div data-testid="radix-root">
                    <button
                        data-testid="mock-overlay-close"
                        onClick={() => onOpenChange(false)}
                    />
                    {children}
                </div>
            ) : null;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Portal: ({ children }: any) => <div>{children}</div>,
        Overlay: () => <div />,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Content: ({ children, 'aria-describedby': describedBy }: any) => <div role="dialog" aria-describedby={describedBy}>{children}</div>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Title: ({ children }: any) => <h1>{children}</h1>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Description: ({ children, id }: any) => <p id={id}>{children}</p>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Close: ({ children }: any) => <button>{children}</button>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Trigger: ({ children }: any) => <button>{children}</button>,
    };
});

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
      <Dialog isOpen={true} onClose={() => {}} title="Test Title" description="Test Description">
        <div data-testid="dialog-content">Content</div>
      </Dialog>
    );
    expect(screen.getByTestId('dialog-content')).toBeInTheDocument();
  });

  it('calls onClose when close event is triggered', () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen={true} onClose={onClose} title="Test Title" description="Test Description" />
    );

    // Simulate a close event originating from Radix (e.g. overlay click or ESC)
    // We use the button we injected into the mocked Root for this purpose.
    const closeTrigger = screen.getByTestId('mock-overlay-close');
    fireEvent.click(closeTrigger);

    expect(onClose).toHaveBeenCalled();
  });

  it('renders footer', () => {
    render(
      <Dialog
        isOpen={true}
        onClose={() => {}}
        title="Test Title"
        description="Test Description"
        footer={<button>Action</button>}
      />
    );
    expect(screen.getByText('Action')).toBeInTheDocument();
  });

  it('applies custom contentClassName to wrapper', () => {
    render(
      <Dialog
        isOpen={true}
        onClose={() => {}}
        title="Test Title"
        contentClassName="test-class-name"
      >
        <div data-testid="dialog-content">Content</div>
      </Dialog>
    );
    const content = screen.getByTestId('dialog-content');
    // The wrapper is the parent of the content
    const wrapper = content.parentElement;
    expect(wrapper).toHaveClass('test-class-name');
    expect(wrapper).toHaveClass('mb-6'); // Default class
  });
});
