/**
 * Toast capture: record every `showToast` call through the REAL
 * `useToastStore` instead of `vi.mock`ing the store module.
 *
 * Phase 8 §D: the store is queue-based now (the single-slot overwrite is
 * dead), but the capture stays useful — it records the RESOLVED display
 * message for every call in order, so suites keep pinning user-visible
 * copy even when call sites pass catalog keys.
 */
import { useToastStore } from '@store/useToastStore';
import type { ToastType } from '@store/useToastStore';
import { resolveMessage, isMessageKey } from '@kernel/locale/messages';

export interface CapturedToast {
  /** Resolved display string (keys resolve through the catalog). */
  message: string;
  /** The catalog key, when the call site passed one. */
  key?: string;
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
    showToast: (content, type = 'info', duration) => {
      const key =
        typeof content === 'object' ? content.key
        : isMessageKey(content) ? content
        : undefined;
      toasts.push({
        message: resolveMessage(content),
        key,
        type,
        duration: duration ?? (type === 'error' ? 5000 : 3000),
      });
      original(content, type, duration);
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
