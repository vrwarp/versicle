import React from 'react';
import { useToastStore } from '@store/useToastStore';
import { Toast } from './ui/Toast';

/**
 * The toast stack host.
 *
 * Mounted in App.tsx ABOVE the router gate, beside every boot-state
 * branch: a toast fired before boot reaches 'ready' stays in the queue
 * store and renders here the moment the host mounts instead of being
 * dropped.
 *
 * The live regions are PERSISTENT (always in the DOM, even
 * with zero toasts) and content is injected into them — regions created
 * together with their content are unreliable across screen readers.
 * Errors land in an assertive `role="alert"` region; info/success in a
 * polite `role="status"` region. The Toast component itself carries no
 * live-region semantics.
 *
 * Lives in components/ (not ui/): it subscribes to the toast store, and
 * `ui/` is kernel-only (the `ui-imports-kernel-only` depcruise rule).
 */
export const ToastHost: React.FC = () => {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);

  const errors = toasts.filter((t) => t.type === 'error');
  const others = toasts.filter((t) => t.type !== 'error');

  return (
    <div
      data-testid="toast-host"
      className="fixed bottom-[calc(5rem+var(--safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none"
    >
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-2 empty:hidden">
        {others.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            action={toast.action}
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
            action={toast.action}
            onClose={() => dismissToast(toast.id)}
          />
        ))}
      </div>
    </div>
  );
};
