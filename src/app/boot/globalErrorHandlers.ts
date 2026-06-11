/**
 * Window-level unhandled-rejection handler (moved verbatim from App.tsx):
 * surfaces storage-full conditions as toasts instead of silent console noise.
 */
import { useToastStore } from '@store/useToastStore';
import { StorageFullError } from '~types/errors';
import { createLogger } from '@lib/logger';

const logger = createLogger('Boot');

/** Install the handler; returns the matching teardown. */
export function installGlobalErrorHandlers(): () => void {
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    logger.error('Unhandled Promise Rejection:', event.reason);

    // Check for critical errors
    if (event.reason instanceof StorageFullError) {
      useToastStore.getState().showToast(event.reason.message, 'error', 5000);
    } else if (event.reason?.name === 'QuotaExceededError' ||
      (typeof event.reason === 'object' && event.reason !== null && 'name' in event.reason && (event.reason as { name: unknown }).name === 'QuotaExceededError')) {
      // Sometimes it might come as a raw QuotaExceededError if not wrapped
      useToastStore.getState().showToast('Storage limit exceeded. Please free up space.', 'error', 5000);
    }
  };

  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  return () => {
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  };
}
