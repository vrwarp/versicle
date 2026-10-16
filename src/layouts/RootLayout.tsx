import { Outlet } from 'react-router-dom';
import { ReaderControlBar } from '@components/reader/ReaderControlBar';
import { ThemeSynchronizer } from '@components/ThemeSynchronizer';
import { LiveAnnouncer } from '@components/ui/LiveAnnouncer';
import { TtsAnnouncements } from '@components/TtsAnnouncements';

import { BackNavigationManager } from '@components/BackNavigationManager';
import { SyncToastPropagator } from '@components/sync/SyncToastPropagator';
import { KeyboardShortcutHost } from '@app/shortcuts/KeyboardShortcutHost';

// Settings are the /settings/:tab route (SettingsShell), not mounted here, so
// the shell does not subscribe to settings stores while settings are closed.
// The toast stack lives ABOVE the router gate (ToastHost in App.tsx), so
// boot-time toasts are not dropped. This layout mounts the screen-reader
// announcement outlet (LiveAnnouncer) and the TTS transition adapter that
// feeds it.
export function RootLayout() {
    return (
        <>
            <BackNavigationManager />
            <SyncToastPropagator />
            <ThemeSynchronizer />
            <LiveAnnouncer />
            <TtsAnnouncements />
            <KeyboardShortcutHost />
            <ReaderControlBar />
            <div className="min-h-screen bg-background text-foreground main_layout">
                <Outlet />
            </div>
        </>
    );
}
