import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/**
 * A reusable modal dialog component.
 */
export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  className
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
        setIsVisible(true);
    } else {
        const timer = setTimeout(() => setIsVisible(false), 200); // Wait for fade out
        return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isVisible && !isOpen) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-200",
        isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
      )}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Content */}
      <div
        className={cn(
          "bg-surface border border-border rounded-lg shadow-lg w-full max-w-md p-6 relative z-10 transform transition-all duration-200 scale-100",
          !isOpen && "scale-95",
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 id="dialog-title" className="text-xl font-bold mb-2 text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted mb-4">{description}</p>}

        <div className="text-foreground mb-6">
          {children}
        </div>

        {footer && (
          <div className="flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
