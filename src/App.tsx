import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { LibraryView } from './components/library/LibraryView';
import { ReaderView } from './components/reader/ReaderView';
import { AudioReaderHUD } from './components/audio/AudioReaderHUD';
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
import { Capacitor } from '@capacitor/core';
import { ForegroundService, Importance } from '@capawesome-team/capacitor-android-foreground-service';
import { AudioPlayerService } from './lib/tts/AudioPlayerService';

/**
 * Main Application component.
 * Sets up routing, global providers, error handling, and initial database connection.
 * Handles "Safe Mode" if the database fails to initialize (e.g. corruption or quota limits).
 *
 * Responsibilities:
 * - Database Initialization (waiting for IndexedDB).
 * - Global Event Listeners (Unhandled Promise Rejections for storage errors).
 * - Android Foreground Service Initialization (Notification Channels).
 * - Routing (Library vs Reader).
 * - Global UI Elements (HUD, Toast, Settings Dialog).
 */
function App() {
  const [dbStatus, setDbStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dbError, setDbError] = useState<unknown>(null);

  // Global Error Handler for Async Storage Failures
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled Promise Rejection:', event.reason);

      // Check for critical errors like Storage Quota Exceeded
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

  // Initialization Logic
  useEffect(() => {
    const init = async () => {
      try {
        // Start Android init in parallel if applicable
        const androidInitPromise = (async () => {
          if (Capacitor.getPlatform() === 'android') {
            try {
              // 1. Setup Notification Channel for Foreground Service
              // This defines how the notification behaves (sound, vibration, visibility).
              // 'importance: 3' (Default) means it shows up but doesn't make a noise (good for media).
              await ForegroundService.createNotificationChannel({
                  id: 'versicle_tts_channel',
                  name: 'Versicle Playback',
                  description: 'Controls for background reading',
                  importance: Importance.Default
              });

              // 2. Listen for "Pause" button clicks on the notification itself
              await ForegroundService.addListener('buttonClicked', async (event) => {
                  if (event.buttonId === 101) {
                      // Map the notification button to our Service logic
                      AudioPlayerService.getInstance().pause();
                  }
              });
            } catch (error) {
               console.error('Failed to initialize Android services:', error);
            }
          }
        })();

        // Initialize DB (This creates the schema if needed)
        await getDB();

        // Wait for Android init to complete (or fail gracefully)
        await androidInitPromise;

        setDbStatus('ready');
      } catch (err) {
        console.error('Failed to initialize DB:', err);
        setDbError(err);
        setDbStatus('error');
      }
    };
    init();
  }, []);

  /**
   * Hard reset handler for Safe Mode.
   * Deletes the entire IndexedDB database and reloads the page.
   */
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

  // Show a simple loading screen during initialization
  if (dbStatus === 'loading') {
      return <div className="min-h-screen flex items-center justify-center bg-background text-foreground">Initializing...</div>;
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeSynchronizer />
      <GlobalSettingsDialog />
      <ToastContainer />
      <AudioReaderHUD />
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
