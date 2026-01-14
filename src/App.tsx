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
import { YjsTest } from './components/debug/YjsTest';
import { useLibraryStore } from './store/useLibraryStore';
import { migrateToYjs } from './lib/migration/YjsMigration';
import { waitForServiceWorkerController } from './lib/serviceWorkerUtils';

import './App.css';

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
  const [migrationStatus, setMigrationStatus] = useState<'pending' | 'migrating' | 'done' | 'error'>('pending');
  const [statusMessage, setStatusMessage] = useState('Initializing...');

  const hydrateStaticMetadata = useLibraryStore(state => state.hydrateStaticMetadata);

  // Initialize Sync
  useSyncOrchestrator();

  // Service Worker Initialization
  useEffect(() => {
    const initSW = async () => {
      try {
        await waitForServiceWorkerController();
      } catch (e) {
        console.error('Service Worker wait failed:', e);
        setSwError("Service Worker failed to take control. This application requires a Service Worker for image loading. Please reload the page.");
      }
      setSwInitialized(true);
    };
    initSW();
  }, []);

  // Global Error Handler
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

  // Main Initialization (DB + Migration)
  useEffect(() => {
    const init = async () => {
      try {
        setStatusMessage('Connecting to database...');
        // Initialize DB
        await getDB();

        setStatusMessage('Checking for upgrades...');
        setMigrationStatus('migrating');
        try {
          await migrateToYjs();
          setMigrationStatus('done');
        } catch (e) {
          console.error('[App] Migration failed:', e);
          // We proceed anyway, but log it
          setMigrationStatus('error');
        }

        setStatusMessage('Loading library...');
        await hydrateStaticMetadata();

        setDbStatus('ready');
      } catch (err) {
        console.error('Failed to initialize App:', err);
        setDbError(err);
        setDbStatus('error');
      }
    };
    init();
  }, [hydrateStaticMetadata]);

  const handleReset = async () => {
    if (!window.confirm('Are you sure you want to delete all data? This cannot be undone.')) {
      return;
    }
    try {
      dbService.cleanup();
      await deleteDB('EpubLibraryDB');
      // Also clear Yjs DB if we really want a full reset?
      // deleteDB('versicle-yjs'); 
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

  // Combined Loading Screen
  if (dbStatus === 'loading' || !swInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-muted-foreground animate-pulse">
            {statusMessage}
          </p>
        </div>
      </div>
    );
  }

  return (
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
      <YjsTest />
    </Router>
  );
}

export default App;
