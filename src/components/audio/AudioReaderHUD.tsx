import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderStore } from '../../store/useReaderStore';
import { CompassPill } from './CompassPill';
import { SatelliteFAB } from './SatelliteFAB';

export const AudioReaderHUD: React.FC = () => {
    const { queue, isPlaying, pause } = useTTSStore();
    const { immersiveMode } = useReaderStore();
    const location = useLocation();

    // Check if we are in Library (root path)
    const isLibrary = location.pathname === '/';

    // Auto-pause when entering library (as per spec)
    useEffect(() => {
        if (isLibrary && isPlaying) {
            pause();
        }
    }, [isLibrary, isPlaying, pause]);

    // Don't render if nothing in queue
    if (!queue || queue.length === 0) {
        return null;
    }

    return (
        <div className="fixed bottom-0 left-0 right-0 pointer-events-none z-[40] flex flex-col items-center justify-end pb-6">
             <div className="relative w-full max-w-md mx-auto pointer-events-auto">
                 {/* FAB Container - Absolute positioned relative to the wrapper */}
                 {!isLibrary && !immersiveMode && (
                     <div className="absolute bottom-20 right-4 z-50">
                         <SatelliteFAB />
                     </div>
                 )}

                 {/* Pill Container */}
                 <div className="mb-4">
                     <CompassPill variant={immersiveMode ? 'compact' : (isLibrary ? 'summary' : 'active')} />
                 </div>
             </div>
        </div>
    );
};
