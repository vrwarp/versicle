import React from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { CompassPill } from './CompassPill';
import { SatellitePlayButton } from './SatellitePlayButton';
import { useLocation } from 'react-router-dom';

/**
 * Container for the "Chapter Compass" floating controls.
 * Manages visibility based on playback state and current route.
 */
export const FloatingControlsContainer: React.FC = () => {
    const { status } = useTTSStore();
    const location = useLocation();

    // Determine if we should show the controls
    // 1. Must have an active session (not stopped)
    const hasActiveSession = status !== 'stopped';

    // 2. Ideally, we don't show this ON TOP of the ReaderView if the ReaderView
    // already has controls. But the spec says "navigating away from the active ReaderView".
    // So if we are IN the ReaderView, we might want to hide this HUD
    // to avoid duplication with the Reader's own UI (if it has one).
    // However, the spec calls it a "Chapter Compass" for "Headless" navigation.
    // Let's assume we hide it on the Reader route (`/read/:id`).
    const isReaderRoute = location.pathname.startsWith('/read/');

    if (!hasActiveSession || isReaderRoute) {
        return null;
    }

    return (
        <div className="fixed inset-0 pointer-events-none z-[40]">
            {/* Compass Pill - Pointer events re-enabled on the component itself via its interactive elements,
                but we need to ensure the parent doesn't block.
                The parent is pointer-events-none. Children with pointer-events-auto will work.
            */}
            <div className="pointer-events-auto">
                <CompassPill />
            </div>

            <div className="pointer-events-auto">
                <SatellitePlayButton />
            </div>
        </div>
    );
};
