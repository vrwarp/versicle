/**
 * Toast capture: record every `showToast` call through the REAL
 * `useToastStore` instead of `vi.mock`ing the store module.
 *
 * The store is single-slot (a second toast overwrites the first), so
 * asserting on the store state alone loses messages; the capture keeps the
 * full sequence.
 */
import { useToastStore } from '../../store/useToastStore';
import type { ToastType } from '../../store/useToastStore';

export interface CapturedToast {
  message: string;
  type: ToastType;
  duration: number;
}

export interface ToastCapture {
  /** Every toast shown since capture started, in order. */
  toasts: CapturedToast[];
  /** Messages only — convenient for `expect(...).toContain(...)`. */
  messages(): string[];
  /** Restore the original `showToast`. */
  restore(): void;
}

/**
 * Start capturing toasts. Always call `restore()` (or reset the store via
 * `resetStore(useToastStore)`) so the wrapped action does not leak into the
 * next test.
 */
export function captureToasts(): ToastCapture {
  const toasts: CapturedToast[] = [];
  const original = useToastStore.getState().showToast;
  useToastStore.setState({
    showToast: (message, type = 'info', duration = 3000) => {
      toasts.push({ message, type, duration });
      original(message, type, duration);
    },
  });
  return {
    toasts,
    messages: () => toasts.map((t) => t.message),
    restore: () => {
      useToastStore.setState({ showToast: original });
    },
  };
}
