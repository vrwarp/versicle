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
import { MigrationService } from './lib/MigrationService';
import { Progress } from './components/ui/Progress';

/**
 * Main Application component.
 * Sets up routing, global providers, error handling, and initial database connection.
 * Handles "Safe Mode" if the database fails to initialize.
 */
function App() {
  const [dbStatus, setDbStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dbError, setDbError] = useState<unknown>(null);
  const [migrationProgress, setMigrationProgress] = useState<{ percent: number; message: string } | null>(null);

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

        // Check and run migrations if necessary
        const migrationRequired = await MigrationService.isMigrationRequired();
        if (migrationRequired) {
            setMigrationProgress({ percent: 0, message: 'Updating library format...' });

            await MigrationService.migrateLibrary((progress, message) => {
                 setMigrationProgress({ percent: progress, message });
            });

            setMigrationProgress(null);
            useToastStore.getState().showToast('Library update complete.', 'success');
        }

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
  if (dbStatus === 'loading') {
      if (migrationProgress) {
          return (
              <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background text-foreground p-8">
                  <div className="w-full max-w-md space-y-4">
                      <h2 className="text-xl font-bold text-center">Updating Library</h2>
                      <p className="text-sm text-center text-muted-foreground">{migrationProgress.message}</p>
                      <Progress value={migrationProgress.percent} className="h-2" />
                  </div>
              </div>
          );
      }
      return <div className="min-h-screen flex items-center justify-center bg-background text-foreground">Initializing...</div>;
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeSynchronizer />
      <GlobalSettingsDialog />
      <ToastContainer />
      <ReaderControlBar />
      <div className="min-h-screen bg-background text-foreground">
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
  );
}

export default App;
