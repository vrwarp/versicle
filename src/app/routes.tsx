/**
 * The route tree (Phase 8 §A). Defined at module scope so the router is
 * created once, never per render.
 *
 * Route map:
 *   /                → LibraryView (EAGER — the boot surface)
 *   /notes           → LibraryView in notes context (GlobalNotesView itself
 *                      is lazy inside LibraryView; replaces the synced
 *                      `activeContext` preference switch, §J)
 *   /read/:id        → ReaderShell, React.lazy (pulls epubjs out of the
 *                      entry chunk — asserted by check 4 of
 *                      scripts/check-worker-chunk.mjs)
 *   /settings/:tab?  → SettingsShell over the library (URL-addressable
 *                      overlay; the registry-driven replacement for
 *                      GlobalSettingsDialog, §B). Closing = history back,
 *                      so hardware/browser back "closes the dialog" with
 *                      no dedicated guard.
 */
import { Suspense, lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { RootLayout } from '../layouts/RootLayout';
import { LibraryView } from '@components/library/LibraryView';
import { ErrorBoundary } from '@components/ErrorBoundary';

const ReaderShellLazy = lazy(() =>
  import('@components/reader/ReaderShell').then((m) => ({ default: m.ReaderShell })),
);
const SettingsShellLazy = lazy(() =>
  import('./settings/SettingsShell').then((m) => ({ default: m.SettingsShell })),
);

/** Shared route-chunk fallback — the boot spinner, reused. */
export function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div
        className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}

// Note: We use ErrorBoundary components within routes to isolate failures.
export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: (
      <ErrorBoundary>
        <div className="flex items-center justify-center h-screen bg-background text-foreground">
          <div className="p-8 border border-destructive/50 rounded-lg bg-destructive/10">
            <h2 className="text-xl font-bold mb-2">Application Error</h2>
            <p>A critical error occurred in the application shell.</p>
            <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded">
              Reload Application
            </button>
          </div>
        </div>
      </ErrorBoundary>
    ),
    children: [
      {
        index: true,
        element: (
          <ErrorBoundary>
            <LibraryView />
          </ErrorBoundary>
        ),
      },
      {
        path: "notes",
        element: (
          <ErrorBoundary>
            <LibraryView context="notes" />
          </ErrorBoundary>
        ),
      },
      {
        path: "read/:id",
        element: (
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <ReaderShellLazy />
            </Suspense>
          </ErrorBoundary>
        ),
      },
      {
        // The settings overlay renders OVER the library (deep-link
        // acceptance: /settings/diagnostics cold-load = dialog on
        // Diagnostics over the library). In-app openers navigate here;
        // close = navigate back (or '/' on cold load).
        path: "settings/:tab?",
        element: (
          <ErrorBoundary>
            <LibraryView />
            <Suspense fallback={null}>
              <SettingsShellLazy />
            </Suspense>
          </ErrorBoundary>
        ),
      },
    ],
  },
]);
