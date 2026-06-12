import { Outlet } from 'react-router-dom';
import { ReaderControlBar } from '@components/reader/ReaderControlBar';
import { ThemeSynchronizer } from '@components/ThemeSynchronizer';
import { ToastContainer } from '@components/ui/ToastContainer';

import { BackNavigationManager } from '@components/BackNavigationManager';
import { SyncToastPropagator } from '@components/sync/SyncToastPropagator';

// Phase 8 §B: GlobalSettingsDialog left this layout — settings are the
// /settings/:tab route (SettingsShell). The shell no longer subscribes to
// ten stores while settings are closed.
export function RootLayout() {
    return (
        <>
            <BackNavigationManager />
            <SyncToastPropagator />
            <ThemeSynchronizer />
            <ToastContainer />
            <ReaderControlBar />
            <div className="min-h-screen bg-background text-foreground main_layout">
                <Outlet />
            </div>
        </>
    );
}
