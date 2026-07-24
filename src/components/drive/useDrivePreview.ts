/**
 * useDrivePreview — React access to the partial-fetch Drive preview service.
 *
 * Fronts DriveMetadataService.getPreview with the lifecycle a component needs:
 * cancellation on unmount / fileId change (an AbortSignal threaded to the
 * ranged fetch, so a fast scroll doesn't keep spending the background quota on
 * rows that left the viewport), and an object URL for the cover Blob that is
 * revoked on cleanup.
 *
 * `enabled` gates the fetch — pass the row's intersection-observer visibility
 * so the network call only happens for on-screen rows (R4). `priority`
 * defaults to 'viewport'; the restore/preview dialogs pass 'interactive'.
 */
import { useEffect, useMemo, useState } from 'react';
import { getDriveMetadataService } from '@domains/google';
import type { DrivePreviewOutcome, DrivePreviewPriority } from '@domains/google';

export interface UseDrivePreviewResult {
  status: DrivePreviewOutcome['status'] | 'idle' | 'loading';
  title?: string;
  author?: string;
  description?: string;
  language?: string;
  /** Object URL for the cover image, valid until the hook re-runs. */
  coverUrl?: string;
  /** True while the ranged fetch is in flight. */
  loading: boolean;
  /** True when the token was unavailable — the caller can offer a reconnect. */
  needsAuth: boolean;
}

interface Options {
  enabled?: boolean;
  priority?: DrivePreviewPriority;
  interactive?: boolean;
}

interface InternalState {
  forFile?: string;
  loading: boolean;
  outcome: DrivePreviewOutcome | null;
}

const IDLE: UseDrivePreviewResult = { status: 'idle', loading: false, needsAuth: false };

export function useDrivePreview(
  fileId: string | undefined,
  { enabled = true, priority = 'viewport', interactive = false }: Options = {},
): UseDrivePreviewResult {
  const [state, setState] = useState<InternalState>({ loading: false, outcome: null });
  const active = !!fileId && enabled;

  // Derived reset DURING RENDER (React's "adjust state on prop change" pattern):
  // whenever the target file changes we drop to loading with a cleared outcome,
  // and when disabled we return to idle. Keeping this out of the effect avoids
  // synchronous setState-in-effect (react-hooks/set-state-in-effect).
  if (active && state.forFile !== fileId) {
    setState({ forFile: fileId, loading: true, outcome: null });
  } else if (!active && state.forFile !== undefined) {
    setState({ forFile: undefined, loading: false, outcome: null });
  }

  useEffect(() => {
    if (!active || !fileId) return;
    const controller = new AbortController();
    let cancelled = false;
    // All setState happens in async callbacks (never synchronously here). The
    // Promise.resolve wrapper also routes an unwired-service throw into .catch
    // instead of throwing out of the effect.
    Promise.resolve()
      .then(() =>
        getDriveMetadataService().getPreview(fileId, {
          priority,
          interactive,
          signal: controller.signal,
        }),
      )
      .then((result) => {
        if (!cancelled) {
          setState((s) => (s.forFile === fileId ? { ...s, loading: false, outcome: result } : s));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState((s) =>
            s.forFile === fileId ? { ...s, loading: false, outcome: { status: 'error' } } : s,
          );
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fileId, active, priority, interactive]);

  const coverBlob = state.outcome?.preview?.cover;
  const coverUrl = useMemo(
    () => (coverBlob ? URL.createObjectURL(coverBlob) : undefined),
    [coverBlob],
  );
  useEffect(() => {
    return () => {
      if (coverUrl) URL.revokeObjectURL(coverUrl);
    };
  }, [coverUrl]);

  if (!active) return IDLE;

  const preview = state.outcome?.preview;
  return {
    status: state.loading ? 'loading' : (state.outcome?.status ?? 'idle'),
    title: preview?.title,
    author: preview?.author,
    description: preview?.description,
    language: preview?.language,
    coverUrl,
    loading: state.loading,
    needsAuth: state.outcome?.status === 'auth',
  };
}
