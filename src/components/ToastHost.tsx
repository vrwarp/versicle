import React from 'react';
import { useToastStore } from '@store/useToastStore';
import { Toast } from './ui/Toast';

/**
 * The toast stack host (Phase 8 §D) — replaces ui/ToastContainer.
 *
 * Mounted in App.tsx ABOVE the router gate, beside every boot-state
 * branch: a toast fired before boot reaches 'ready' stays in the queue
 * store and renders here the moment the host mounts — the legacy
 * container lived in RootLayout (below the gate) and silently dropped
 * boot-time toasts.
 *
 * a11y item 10: the live regions are PERSISTENT (always in the DOM, even
 * with zero toasts) and content is injected into them — regions created
 * together with their content are unreliable across screen readers.
 * Errors land in an assertive `role="alert"` region; info/success in a
 * polite `role="status"` region. The Toast component itself carries no
 * live-region semantics.
 *
 * Lives in components/ (not ui/): it subscribes to the toast store, and
 * `ui/` is kernel-only by the Phase 8 §L depcruise rule — landing the
 * host here deletes that rule's two named Toast carve-outs.
 */
export const ToastHost: React.FC = () => {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);

  const errors = toasts.filter((t) => t.type === 'error');
  const others = toasts.filter((t) => t.type !== 'error');

  return (
    <div
      data-testid="toast-host"
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none"
    >
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-2 empty:hidden">
        {others.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => dismissToast(toast.id)}
          />
        ))}
      </div>
      <div role="alert" aria-live="assertive" className="flex flex-col items-center gap-2 empty:hidden">
        {errors.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => dismissToast(toast.id)}
          />
        ))}
      </div>
    </div>
  );
};
