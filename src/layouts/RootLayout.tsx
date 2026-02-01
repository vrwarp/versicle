import { Outlet } from 'react-router-dom';
import { ReaderControlBar } from '../components/reader/ReaderControlBar';
import { ThemeSynchronizer } from '../components/ThemeSynchronizer';
import { GlobalSettingsDialog } from '../components/GlobalSettingsDialog';
import { ToastContainer } from '../components/ui/ToastContainer';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SyncToastPropagator } from '../components/sync/SyncToastPropagator';

import { BackNavigationManager } from '../components/BackNavigationManager';

export function RootLayout() {
    return (
        <>
            <BackNavigationManager />
            <SyncToastPropagator />
            <ThemeSynchronizer />
            <ErrorBoundary>
                <GlobalSettingsDialog />
            </ErrorBoundary>
            <ToastContainer />
            <ReaderControlBar />
            <div className="min-h-screen bg-background text-foreground main_layout">
                <Outlet />
            </div>
        </>
    );
}
