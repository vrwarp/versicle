import React from 'react';
import { useToastStore } from '../../store/useToastStore';
import { Toast } from './Toast';

/**
 * A container that subscribes to the global toast store and renders the Toast component.
 * Place this once at the root of your application (e.g., in App.tsx).
 */
export const ToastContainer: React.FC = () => {
  const { isVisible, message, type, duration, hideToast } = useToastStore();

  return (
    <Toast
      isVisible={isVisible}
      message={message}
      type={type}
      duration={duration}
      onClose={hideToast}
    />
  );
};
