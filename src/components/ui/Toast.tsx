import React, { useEffect } from 'react';
import { CheckCircle, XCircle, Info } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  isVisible: boolean;
  onClose: () => void;
  duration?: number;
  type?: ToastType;
}

/**
 * A simple Toast component that appears at the bottom of the screen.
 */
export const Toast: React.FC<ToastProps> = ({ message, isVisible, onClose, duration = 3000, type = 'error' }) => {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isVisible, duration, onClose]);

  if (!isVisible) return null;

  const styles = {
      success: "bg-green-600 text-white border-green-700",
      error: "bg-destructive text-destructive-foreground border-border",
      info: "bg-primary text-primary-foreground border-primary-foreground/20"
  };

  const icons = {
      success: <CheckCircle className="w-4 h-4" />,
      error: <XCircle className="w-4 h-4" />,
      info: <Info className="w-4 h-4" />
  };

  return (
    <div className={cn(
        "fixed bottom-20 left-1/2 transform -translate-x-1/2 px-4 py-3 rounded-lg shadow-lg z-50 text-sm font-medium border animate-in fade-in slide-in-from-bottom-5 flex items-center gap-2",
        styles[type]
    )}>
      {icons[type]}
      {message}
    </div>
  );
};
