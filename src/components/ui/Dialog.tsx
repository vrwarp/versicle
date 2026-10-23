import React from 'react';
import { cn } from '@lib/utils';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from './Modal';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  hideCloseButton?: boolean;
  className?: string;
  contentClassName?: string;
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
 * @param props.hideCloseButton - Whether to hide the close (X) button.
 * @param props.className - Optional className to override default styles (e.g. width).
 * @param props.contentClassName - Optional className for the content wrapper.
 * @returns The rendered Dialog component.
 */
export const Dialog: React.FC<DialogProps> = ({ isOpen, onClose, title, description, children, footer, hideCloseButton, className, contentClassName }) => {
  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      {/* Without a description, opt out of aria-describedby (Radix's documented
          escape hatch) rather than announcing a meaningless placeholder. */}
      <ModalContent
        className={`max-w-md ${className || ''}`}
        hideCloseButton={hideCloseButton}
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          {description && <ModalDescription>{description}</ModalDescription>}
        </ModalHeader>
        <div className={cn("mb-6 text-foreground min-w-0", contentClassName)}>{children}</div>
        {footer && <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">{footer}</div>}
      </ModalContent>
    </Modal>
  );
};
