/**
 * React owner of the boot sequence: registers the app's boot tasks, runs the
 * bootstrap sequencer once per mount, and projects its outcome into a small
 * render-state union for App.tsx.
 */
import { useEffect, useState } from 'react';
import {
  runBootSequence,
  type BootHaltReason,
  type PendingWorkspaceMigration,
} from '../bootstrap';
import { registerAppBootTasks } from './registerBootTasks';
import { installGlobalErrorHandlers } from './globalErrorHandlers';
import { createLogger } from '@lib/logger';
import { isChunkLoadError, reloadOnceForChunkError } from '@lib/chunkReload';

const logger = createLogger('Boot');

export type AppBootState =
  | { status: 'loading'; message: string }
  | { status: 'ready'; pendingMigration: PendingWorkspaceMigration | null }
  /** Boot intentionally stopped (e.g. a backup restore is reloading the page). */
  | { status: 'halted'; reason: BootHaltReason; message: string }
  | { status: 'error'; error: unknown };

export function useBootSequence(): AppBootState {
  const [state, setState] = useState<AppBootState>({ status: 'loading', message: 'Initializing...' });

  useEffect(() => {
    let active = true;
    let lastMessage = 'Initializing...';

    const removeErrorHandlers = installGlobalErrorHandlers();
    registerAppBootTasks();

    const handle = runBootSequence({
      onStatusMessage: (message) => {
        lastMessage = message;
        if (active) {
          setState((prev) => (prev.status === 'loading' ? { status: 'loading', message } : prev));
        }
      },
    });

    handle.promise
      .then((result) => {
        if (!active) return;
        if (result.status === 'ready') {
          setState({ status: 'ready', pendingMigration: result.pendingMigration });
        } else {
          setState({ status: 'halted', reason: result.reason, message: lastMessage });
        }
      })
      .catch((error: unknown) => {
        logger.error('Failed to initialize App:', error);
        // Boot itself lazy-imports chunks (createSync etc.); an import
        // aborted by a mid-boot reload is cached as rejected for this
        // document, so retrying in place cannot succeed — reload once for a
        // fresh module map instead of stranding the user on the error screen.
        if (isChunkLoadError(error) && reloadOnceForChunkError('boot')) return;
        if (active) setState({ status: 'error', error });
      });

    return () => {
      active = false;
      removeErrorHandlers();
      handle.dispose();
    };
  }, []);

  return state;
}
