import React, { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import type { ToastType } from '../../store/useToastStore';

export interface ToastProps {
  message: string;
  isVisible: boolean;
  type?: ToastType;
  onClose: () => void;
  duration?: number;
}

/**
 * A simple Toast component that appears at the bottom of the screen.
 * Supports info, success, and error types.
 */
export const Toast: React.FC<ToastProps> = ({
  message,
  isVisible,
  type = 'info',
  onClose,
  duration = 3000
}) => {
  useEffect(() => {
    if (isVisible && duration > 0) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isVisible, duration, onClose]);

  if (!isVisible) return null;

  const getStyles = () => {
    switch (type) {
      case 'success':
        return 'bg-green-600 text-white border-green-700';
      case 'error':
        return 'bg-destructive text-destructive-foreground border-border';
      case 'info':
      default:
        return 'bg-blue-600 text-white border-blue-700';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success': return <CheckCircle className="w-5 h-5" />;
      case 'error': return <AlertCircle className="w-5 h-5" />;
      case 'info': default: return <Info className="w-5 h-5" />;
    }
  };

  return (
    <div
      className={cn(
        "fixed bottom-20 left-1/2 transform -translate-x-1/2 px-4 py-3 rounded-lg shadow-lg z-[100] text-sm font-medium border animate-in fade-in slide-in-from-bottom-5 flex items-center gap-3 min-w-[300px] max-w-md",
        getStyles()
      )}
      role="alert"
    >
      <div className="shrink-0">
        {getIcon()}
      </div>
      <div className="flex-1 mr-2">
        {message}
      </div>
      <button
        onClick={onClose}
        className="shrink-0 p-1 hover:bg-black/10 rounded-full transition-colors"
        aria-label="Close"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
