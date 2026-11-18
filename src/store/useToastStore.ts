import { create } from 'zustand';
import { resolveMessage, isMessageKey, type MessageInput } from '@kernel/locale/messages';

/**
 * Defines the type of toast message.
 */
export type ToastType = 'info' | 'error' | 'success';

/**
 * An optional action button on a toast (e.g. the SW update prompt's
 * persistent "Reload" toast). The label resolves through the catalog like
 * the message itself.
 */
export interface ToastAction {
  /** Catalog key (or deprecated prose) for the button label. */
  label: MessageInput | string;
  /** Invoked on click; the host dismisses the toast afterwards. */
  onAction: () => void;
}

/** One queued toast. */
export interface ToastEntry {
  /** Monotonic id (dismissal handle + React key). */
  id: number;
  /** Resolved display string (keys resolve at enqueue time). */
  message: string;
  /** The catalog key, when the call site passed one (dedupe + tests). */
  key?: string;
  /** Optional lifecycle group — a newer phase with the same groupKey replaces the prior one in place. */
  groupKey?: string;
  /** The type of toast (affects styling + live-region channel). */
  type: ToastType;
  /** Auto-dismiss after this many ms; <= 0 or Infinity = persistent. */
  duration: number;
  /** Resolved action button, when the call site passed one. */
  action?: { label: string; onAction: () => void };
}

/** Queue cap: per-file import errors must not flood the screen. */
const MAX_TOASTS = 5;

let nextToastId = 1;

/**
 * Multi-phase catalog prefixes whose later phases ("applied", "failed", etc.)
 * supersede an in-flight progress toast ("started", "downloading") rather than
 * stacking beside it.
 */
const LIFECYCLE_KEY_PREFIXES = ['sync.cleanSync.', 'sync.switch.'] as const;

function deriveLifecycleGroupKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  for (const prefix of LIFECYCLE_KEY_PREFIXES) {
    if (key.startsWith(prefix)) return prefix.slice(0, -1);
  }
  return undefined;
}

/**
 * State interface for the Toast notification store.
 *
 * QUEUE-based: a second toast stacks instead of overwriting the first (see
 * the regression block in useToastStore.test.ts). Each toast has its own
 * timer (owned by the Toast component), and the container mounts ABOVE the
 * router gate so boot-time toasts render after mount instead of being
 * dropped.
 */
interface ToastState {
  /** The visible toast stack, oldest first. */
  toasts: ToastEntry[];
  /**
   * Show a toast.
   *
   * Content is a catalog key or `{ key, params }` per the i18n ADR.
   * Free-form prose remains accepted as a DEPRECATED overload while the
   * remaining prose call sites migrate opportunistically — new call sites
   * use keys.
   *
   * @param content - MessageKey, `{key, params}`, or (deprecated) prose.
   * @param type - The toast type (default: 'info').
   * @param duration - ms; defaults to 3000, errors default to 5000.
   * @param action - Optional action button (label resolves like content).
   */
  showToast: (
    content: (MessageInput & { groupKey?: string }) | MessageInput | string,
    type?: ToastType,
    duration?: number,
    action?: ToastAction,
  ) => void;
  /** Dismiss one toast by id. */
  dismissToast: (id: number) => void;
  /** Dismiss everything (kept for tests). */
  hideToast: () => void;
}

/**
 * Zustand store for managing global toast notifications.
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: (content, type = 'info', duration, action) => {
    const message = resolveMessage(content);
    const key =
      typeof content === 'object' ? content.key
      : isMessageKey(content) ? content
      : undefined;
    const explicitGroupKey =
      typeof content === 'object' && 'groupKey' in content ? content.groupKey : undefined;
    const groupKey = explicitGroupKey ?? deriveLifecycleGroupKey(key);
    const effectiveDuration = duration ?? (type === 'error' ? 5000 : 3000);
    const resolvedAction = action
      ? { label: resolveMessage(action.label), onAction: action.onAction }
      : undefined;
    set((state) => {
      // Dedupe: an identical visible toast refreshes instead of
      // stacking — replace it with a fresh entry (new id restarts the
      // timer and re-announces). Lifecycle group matches (e.g. cleanSync
      // started → applied) also replace the earlier phase in place.
      const kept = state.toasts.filter(
        (t) =>
          !(t.message === message && t.type === type) &&
          !(groupKey !== undefined && t.groupKey === groupKey),
      );
      const next = [
        ...kept,
        {
          id: nextToastId++,
          message,
          key,
          groupKey,
          type,
          duration: effectiveDuration,
          action: resolvedAction,
        },
      ];
      // Cap: drop the oldest beyond the limit.
      return { toasts: next.slice(-MAX_TOASTS) };
    });
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  hideToast: () => set({ toasts: [] }),
}));
