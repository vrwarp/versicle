import React, { useEffect, useState } from 'react';
import { cn } from '@lib/utils';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import { Button } from './Button';

/** Visual variant — structurally identical to the store's ToastType. */
type ToastVariant = 'info' | 'error' | 'success';

export interface ToastProps {
  message: string;
  type?: ToastVariant;
  /** Auto-dismiss after this many ms; <= 0 or Infinity = persistent. */
  duration?: number;
  /**
   * Optional action button (Phase 8 §G: the SW update prompt's "Reload").
   * The toast closes itself after the action runs.
   */
  action?: { label: string; onAction: () => void };
  onClose: () => void;
}

/**
 * One toast in the stack (Phase 8 §D) — pure presentation, no store
 * import (`ui/` is kernel-only; the queue subscription lives in
 * src/components/ToastHost.tsx).
 *
 * Owns its dismiss timer: pauses on hover AND on focus-within (a11y —
 * keyboard users get the same read-time grace as mouse users), restarts
 * in full on resume. The surrounding live region is persistent and owned
 * by ToastHost; this node is plain content injected into it.
 */
export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'info',
  duration = 3000,
  action,
  onClose,
}) => {
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (duration > 0 && Number.isFinite(duration) && !isPaused) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose, isPaused]);

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
      data-testid="toast"
      data-toast-type={type}
      className={cn(
        "px-4 py-3 rounded-lg shadow-lg text-sm font-medium border animate-in fade-in slide-in-from-bottom-5 flex items-center gap-3 min-w-[300px] max-w-md pointer-events-auto",
        getStyles()
      )}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={(e) => {
        // Resume only when focus leaves the toast entirely (focus-within).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsPaused(false);
        }
      }}
    >
      <div className="shrink-0">
        {getIcon()}
      </div>
      <div className="flex-1 mr-2">
        {message}
      </div>
      {action && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="toast-action"
          onClick={() => {
            action.onAction();
            onClose();
          }}
          className="shrink-0 font-semibold underline underline-offset-2 hover:bg-black/10"
        >
          {action.label}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="h-6 w-6 shrink-0 rounded-full transition-colors hover:bg-black/10"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
};
