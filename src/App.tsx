import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { LibraryView } from './components/library/LibraryView';
import { ReaderView } from './components/reader/ReaderView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useEffect, useState } from 'react';
import { getDB } from './db/db';
import { dbService } from './db/DBService';
import { SafeModeView } from './components/SafeModeView';
import { deleteDB } from 'idb';
import { useToastStore } from './store/useToastStore';
import { StorageFullError } from './types/errors';
import { useLibraryStore, useBookStore } from './store/useLibraryStore';
import { waitForYjsSync } from './store/yjs-provider';
import { useDeviceStore } from './store/useDeviceStore';
import { getDeviceId } from './lib/device-id';
import { waitForServiceWorkerController } from './lib/serviceWorkerUtils';
import type { DeviceProfile } from './types/device';
import { useTTSStore } from './store/useTTSStore';
import { usePreferencesStore } from './store/usePreferencesStore';
import { createLogger } from './lib/logger';
import { RootLayout } from './layouts/RootLayout';

import './App.css';

const logger = createLogger('App');

// Define router outside of the component to avoid recreation on render
// However, since we might want it to be static, this is fine.
// Note: We use ErrorBoundary components within routes to isolate failures.
const router = createBrowserRouter([
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
            <ReaderView />
          </ErrorBoundary>
        ),
      },
    ],
  },
]);

/**
 * Main Application component.
 * Sets up global providers, error handling, and initial database connection.
 * Handles "Safe Mode" if the database fails to initialize.
 * Renders RouterProvider once ready.
 */
function App() {
  const [dbStatus, setDbStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dbError, setDbError] = useState<unknown>(null);
  const [swInitialized, setSwInitialized] = useState(false);
  const [swError, setSwError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Initializing...');

  const hydrateStaticMetadata = useLibraryStore(state => state.hydrateStaticMetadata);

  // Service Worker Initialization
  useEffect(() => {
    const initSW = async () => {
      try {
        await waitForServiceWorkerController();
      } catch (e) {
        logger.error('Service Worker wait failed:', e);
        setSwError("Service Worker failed to take control. This application requires a Service Worker for image loading. Please reload the page.");
      }
      setSwInitialized(true);
    };
    initSW();
  }, []);

  // Global Error Handler
  useEffect(() => {
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
  }, []);

  // Main Initialization (DB + Migration)
  useEffect(() => {
    const init = async () => {
      try {
        setStatusMessage('Connecting to database...');
        // Initialize DB
        await getDB();

        // Register device if not present
        const deviceId = getDeviceId();
        const deviceStore = useDeviceStore.getState();

        // Construct Profile
        // We do this inside the effect to get latest values, though on mount they are initial.
        // For meaningful profile updates, we might want to listen to changes or update on specific triggers.
        // For now, on-launch registration is sufficient as per requirements.
        await waitForYjsSync();

        const prefs = usePreferencesStore.getState();
        const tts = useTTSStore.getState();
        tts.initialize();

        const profile: DeviceProfile = {
          theme: prefs.currentTheme,
          fontSize: prefs.fontSize,
          ttsVoiceURI: tts.voice ? tts.voice.id : null,
          ttsRate: tts.rate,
          ttsPitch: tts.pitch
        };

        if (!deviceStore.devices[deviceId]) {
          logger.info('Registering new device:', deviceId);
          deviceStore.registerCurrentDevice(deviceId, profile);
        } else {
          // Touch device to update last active and Sync Profile
          // We assume on app launch we want to sync the profile too
          deviceStore.registerCurrentDevice(deviceId, profile);
        }

        // Setup Heartbeat (every 5 mins)
        // We assign to a ref or let variable if we wanted to clear it, but since this is inside async init, 
        // we should move interval setup out or handle cleanup via a ref.
        // For simplicity in this fix, we will just start the interval. 
        // Ideally we'd hoist the intervalId to useEffect scope.

        // Wait for middleware to sync books (short poll)
        let attempts = 0;
        while (Object.keys(useBookStore.getState().books).length === 0 && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }

        await hydrateStaticMetadata();

        setDbStatus('ready');
      } catch (err) {
        logger.error('Failed to initialize App:', err);
        setDbError(err);
        setDbStatus('error');
      }
    };

    // Start Heartbeat independently or track it? 
    // To fix properly, we track the interval ID.
    const heartbeatInterval = setInterval(() => {
      const deviceId = getDeviceId();
      useDeviceStore.getState().touchDevice(deviceId);
    }, 5 * 60 * 1000);

    init();

    return () => {
      clearInterval(heartbeatInterval);
    };
  }, [hydrateStaticMetadata]);

  const handleReset = async () => {
    if (!window.confirm('Are you sure you want to delete all data? This cannot be undone.')) {
      return;
    }
    try {
      dbService.cleanup();
      await deleteDB('EpubLibraryDB');
      window.location.reload();
    } catch (err) {
      logger.error('Failed to delete DB:', err);
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
    <RouterProvider router={router} />
  );
}

export default App;
