import { Outlet } from 'react-router-dom';
import { ReaderControlBar } from '@components/reader/ReaderControlBar';
import { ThemeSynchronizer } from '@components/ThemeSynchronizer';
import { LiveAnnouncer } from '@components/ui/LiveAnnouncer';
import { TtsAnnouncements } from '@components/TtsAnnouncements';

import { BackNavigationManager } from '@components/BackNavigationManager';
import { SyncToastPropagator } from '@components/sync/SyncToastPropagator';

// Phase 8 §B: GlobalSettingsDialog left this layout — settings are the
// /settings/:tab route (SettingsShell). The shell no longer subscribes to
// ten stores while settings are closed.
// Phase 8 §D: the toast stack moved ABOVE the router gate (ToastHost in
// App.tsx — boot-time toasts no longer drop). This layout mounts the
// screen-reader announcement outlet (LiveAnnouncer) and the TTS
// transition adapter that feeds it.
export function RootLayout() {
    return (
        <>
            <BackNavigationManager />
            <SyncToastPropagator />
            <ThemeSynchronizer />
            <LiveAnnouncer />
            <TtsAnnouncements />
            <ReaderControlBar />
            <div className="min-h-screen bg-background text-foreground main_layout">
                <Outlet />
            </div>
        </>
    );
}
