import React, { useEffect } from 'react';

interface ToastProps {
  message: string;
  isVisible: boolean;
  onClose: () => void;
  duration?: number;
}

/**
 * A simple Toast component that appears at the bottom of the screen.
 */
export const Toast: React.FC<ToastProps> = ({ message, isVisible, onClose, duration = 3000 }) => {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isVisible, duration, onClose]);

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-destructive text-destructive-foreground px-4 py-3 rounded-lg shadow-lg z-50 text-sm font-medium border border-border animate-in fade-in slide-in-from-bottom-5">
      {message}
    </div>
  );
};
