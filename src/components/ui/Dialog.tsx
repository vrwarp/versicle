import React from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
} from './Modal';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * A reusable modal dialog component using Radix Primitives via Modal.
 *
 * @param props - Component props.
 * @param props.isOpen - Whether the dialog is open.
 * @param props.onClose - Callback when the dialog is closed.
 * @param props.title - The title of the dialog.
 * @param props.description - Optional description text.
 * @param props.children - The content of the dialog.
 * @param props.footer - Optional footer content (e.g. buttons).
 * @returns The rendered Dialog component.
 */
export const Dialog: React.FC<DialogProps> = ({ isOpen, onClose, title, description, children, footer }) => {
  const descriptionId = React.useId();

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="max-w-md" aria-describedby={description ? descriptionId : undefined}>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          {description && <p id={descriptionId} className="text-sm text-muted-foreground">{description}</p>}
        </ModalHeader>
        <div className="mb-6 text-foreground min-w-0">{children}</div>
        {footer && <div className="flex justify-end gap-2">{footer}</div>}
      </ModalContent>
    </Modal>
  );
};
