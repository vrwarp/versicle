import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { LibraryView } from './components/library/LibraryView';
import { ReaderView } from './components/reader/ReaderView';
import { ReaderControlBar } from './components/reader/ReaderControlBar';
import { ThemeSynchronizer } from './components/ThemeSynchronizer';
import { GlobalSettingsDialog } from './components/GlobalSettingsDialog';
import { ToastContainer } from './components/ui/ToastContainer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useEffect, useState } from 'react';
import { getDB } from './db/db';
import { dbService } from './db/DBService';
import { SafeModeView } from './components/SafeModeView';
import { deleteDB } from 'idb';
import { useToastStore } from './store/useToastStore';
import { StorageFullError } from './types/errors';
import { useSyncOrchestrator } from './lib/sync/hooks/useSyncOrchestrator';
import { HydrationGuard } from './components/HydrationGuard';

/**
 * Main Application component.
 * Sets up routing, global providers, error handling, and initial database connection.
 * Handles "Safe Mode" if the database fails to initialize.
 */
function App() {
  const [dbStatus, setDbStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dbError, setDbError] = useState<unknown>(null);
  const [swInitialized, setSwInitialized] = useState(false);
  const [swError, setSwError] = useState<string | null>(null);

  // Initialize Sync
  useSyncOrchestrator();

  useEffect(() => {
    const initSW = async () => {
      // If service worker is supported, wait for it to be ready
      if ('serviceWorker' in navigator) {
        try {
          await navigator.serviceWorker.ready;

          // Poll for controller with exponential backoff
          let attempt = 0;
          let delay = 5;
          while (!navigator.serviceWorker.controller) {
            if (attempt >= 8) {
              throw new Error(`Controller still not ready after ${attempt} attempts`);
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
            attempt++;
          }

        } catch (e) {
          console.error('Service Worker wait failed:', e);
          setSwError("Service Worker failed to take control. This application requires a Service Worker for image loading. Please reload the page.");
        }
      }
      setSwInitialized(true);
    };
    initSW();
  }, []);

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled Promise Rejection:', event.reason);

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
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        // Initialize DB
        await getDB();

        setDbStatus('ready');
      } catch (err) {
        console.error('Failed to initialize DB:', err);
        setDbError(err);
        setDbStatus('error');
      }
    };
    init();
  }, []);

  const handleReset = async () => {
    if (!window.confirm('Are you sure you want to delete all data? This cannot be undone.')) {
      return;
    }
    try {
      dbService.cleanup();
      await deleteDB('EpubLibraryDB');
      window.location.reload();
    } catch (err) {
      console.error('Failed to delete DB:', err);
      alert('Failed to reset database. You may need to clear browser data manually.');
    }
  };

  const handleRetry = () => {
    setDbStatus('loading');
    setDbError(null);
    window.location.reload();
  };

  if (dbStatus === 'error') {
    return <SafeModeView error={dbError} onReset={handleReset} onRetry={handleRetry} />;
  }

  // Optional: Show a loading screen, or just render the app (LibraryView handles its own loading state)
  // Rendering the app immediately allows the UI to show up faster,
  // but if getDB failed we would have hit the error block.
  // If getDB hangs, we are in 'loading'.
  // We can just proceed if 'loading' assuming idb promise handles concurrency if components call getDB.
  // However, for Safe Mode to work, we want to know if it fails.
  // So we wait for 'ready' or just rely on the error catch.

  // If we return null while loading, the app feels slow.
  // But if we render, components might fail if DB is truly broken.
  // Given we want to catch "DB fails to open", waiting is safer for this feature.
  if (swError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-bold mb-2">Critical Error</h1>
            <p className="mb-4">{swError}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
            >
              Reload
            </button>
          </div>
        </div>
      );
  }

  if (dbStatus === 'loading' || !swInitialized) {
      return <div className="min-h-screen flex items-center justify-center bg-background text-foreground">Initializing...</div>;
  }

  return (
    <HydrationGuard>
      <Router>
        <ThemeSynchronizer />
        <GlobalSettingsDialog />
        <ToastContainer />
        <ReaderControlBar />
        <div className="min-h-screen bg-background text-foreground main_layout">
          <Routes>
            <Route path="/" element={
              <ErrorBoundary>
                <LibraryView />
              </ErrorBoundary>
            } />
            <Route path="/read/:id" element={
              <ErrorBoundary>
                <ReaderView />
              </ErrorBoundary>
            } />
          </Routes>
        </div>
      </Router>
    </HydrationGuard>
  );
}

export default App;
