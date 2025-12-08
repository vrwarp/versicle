import { create } from 'zustand';

/**
 * Defines the type of toast message.
 */
export type ToastType = 'info' | 'error' | 'success';

/**
 * State interface for the Toast notification store.
 */
interface ToastState {
  /** Whether the toast is currently visible. */
  isVisible: boolean;
  /** The message to display. */
  message: string;
  /** The type of toast (affects styling). */
  type: ToastType;
  /** Duration in milliseconds to show the toast. */
  duration: number;
  /**
   * Displays a toast message.
   * @param message - The message text.
   * @param type - The toast type (default: 'info').
   * @param duration - Duration in ms (default: 3000).
   */
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  /** Hides the current toast. */
  hideToast: () => void;
}

/**
 * Zustand store for managing global toast notifications.
 */
export const useToastStore = create<ToastState>((set) => ({
  isVisible: false,
  message: '',
  type: 'info',
  duration: 3000,
  showToast: (message, type = 'info', duration = 3000) => set({ isVisible: true, message, type, duration }),
  hideToast: () => set({ isVisible: false }),
}));
