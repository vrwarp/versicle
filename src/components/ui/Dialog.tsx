import React from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * A reusable modal dialog component.
 */
export const Dialog: React.FC<DialogProps> = ({ isOpen, onClose, title, description, children, footer }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-surface border border-border rounded-lg shadow-lg w-full max-w-md p-6 relative animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted hover:text-foreground"
          aria-label="Close"
        >
          <X size={20} />
        </button>
        <h2 className="text-lg font-bold text-foreground mb-2">{title}</h2>
        {description && <p className="text-sm text-muted mb-4">{description}</p>}
        <div className="mb-6 text-foreground">{children}</div>
        {footer && <div className="flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};
