import { create } from 'zustand';
import { resolveMessage, isMessageKey, type MessageInput } from '@kernel/locale/messages';

/**
 * Defines the type of toast message.
 */
export type ToastType = 'info' | 'error' | 'success';

/** One queued toast. */
export interface ToastEntry {
  /** Monotonic id (dismissal handle + React key). */
  id: number;
  /** Resolved display string (keys resolve at enqueue time). */
  message: string;
  /** The catalog key, when the call site passed one (dedupe + tests). */
  key?: string;
  /** The type of toast (affects styling + live-region channel). */
  type: ToastType;
  /** Auto-dismiss after this many ms; <= 0 or Infinity = persistent. */
  duration: number;
}

/** Queue cap (risk 7: per-file import errors must not flood the screen). */
const MAX_TOASTS = 5;

let nextToastId = 1;

/**
 * State interface for the Toast notification store.
 *
 * Phase 8 §D: QUEUE-based — the legacy single-slot store overwrote the
 * visible toast on every call (a second toast lost the first, see the
 * regression block in useToastStore.test.ts). Toasts now stack, each with
 * its own timer (owned by the Toast component), and the container mounts
 * ABOVE the router gate so boot-time toasts render after mount instead of
 * being dropped.
 */
interface ToastState {
  /** The visible toast stack, oldest first. */
  toasts: ToastEntry[];
  /**
   * Show a toast.
   *
   * Content is a catalog key or `{ key, params }` per the i18n ADR.
   * Free-form prose remains accepted as a DEPRECATED overload while the
   * 81 legacy call sites migrate opportunistically — new call sites use
   * keys.
   *
   * @param content - MessageKey, `{key, params}`, or (deprecated) prose.
   * @param type - The toast type (default: 'info').
   * @param duration - ms; defaults to 3000, errors default to 5000.
   */
  showToast: (content: MessageInput | string, type?: ToastType, duration?: number) => void;
  /** Dismiss one toast by id. */
  dismissToast: (id: number) => void;
  /** Dismiss everything (legacy `hideToast()` semantics, kept for tests). */
  hideToast: () => void;
}

/**
 * Zustand store for managing global toast notifications.
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: (content, type = 'info', duration) => {
    const message = resolveMessage(content);
    const key =
      typeof content === 'object' ? content.key
      : isMessageKey(content) ? content
      : undefined;
    const effectiveDuration = duration ?? (type === 'error' ? 5000 : 3000);
    set((state) => {
      // Dedupe (risk 7): an identical visible toast refreshes instead of
      // stacking — replace it with a fresh entry (new id restarts the
      // timer and re-announces).
      const kept = state.toasts.filter((t) => !(t.message === message && t.type === type));
      const next = [...kept, { id: nextToastId++, message, key, type, duration: effectiveDuration }];
      // Cap: drop the oldest beyond the limit.
      return { toasts: next.slice(-MAX_TOASTS) };
    });
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  hideToast: () => set({ toasts: [] }),
}));
