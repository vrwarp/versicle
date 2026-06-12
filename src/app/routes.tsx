/**
 * The route tree (moved verbatim from App.tsx). Defined at module scope so
 * the router is created once, never per render.
 */
import { createBrowserRouter } from 'react-router-dom';
import { RootLayout } from '../layouts/RootLayout';
import { LibraryView } from '@components/library/LibraryView';
import { ReaderShell } from '@components/reader/ReaderShell';
import { ErrorBoundary } from '@components/ErrorBoundary';

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
        path: "read/:id",
        element: (
          <ErrorBoundary>
            <ReaderShell />
          </ErrorBoundary>
        ),
      },
    ],
  },
]);
