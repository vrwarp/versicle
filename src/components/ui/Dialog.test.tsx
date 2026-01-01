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
                    {/* Expose onOpenChange to children via a custom attribute or context if needed,
                        but here we just render children. To test Close, we need to manually trigger onOpenChange. */}
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
        // In the real implementation, Close triggers onOpenChange(false) on Root.
        // In this mock, we can't easily access the parent Root's props without context.
        // However, Modal.tsx puts Close *inside* Content.
        // The Root mock above renders children.
        // We can make the Root mock provide a context or just attach the handler to the window for testing? No.

        // Simpler approach for the test:
        // Verification of "onClose" being called relies on "onOpenChange" being triggered.
        // We can verify that our `Dialog` passes the correct `onOpenChange` handler to `Root`.

        // But to make `fireEvent.click(closeButton)` work, we need `Close` to call `onOpenChange`.
        // Since we can't easily link them in a simple mock, we will trust Radix's internal wiring
        // and instead verify that `Dialog` wires `onOpenChange` to `onClose`.

        // Wait, if we mock `Root`, we intercept the `onOpenChange`.
        // We can render a hidden button in Root that triggers it (as done above with `mock-overlay-close`).
        // Then we click that button in the test to simulate a close event (like clicking overlay or ESC).

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
});
