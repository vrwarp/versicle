import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTTSStore } from '../../store/useTTSStore';
import { CompassPill } from './CompassPill';
import { SatelliteFAB } from './SatelliteFAB';
import { useUIStore } from '../../store/useUIStore';

export const AudioReaderHUD: React.FC = () => {
    const { queue, isPlaying, pause } = useTTSStore();
    const { setBottomInset } = useUIStore();
    const location = useLocation();

    // Check if we are in Library (root path)
    const isLibrary = location.pathname === '/';

    const hasQueue = queue && queue.length > 0;

    // Auto-pause when entering library (as per spec)
    useEffect(() => {
        if (isLibrary && isPlaying) {
            pause();
        }
    }, [isLibrary, isPlaying, pause]);

    // Update bottom inset based on visibility
    useEffect(() => {
        if (hasQueue) {
            // Reserve space for the pill (approx 160px for summary mode/clearance)
            setBottomInset(160);
        } else {
            setBottomInset(0);
        }
        return () => setBottomInset(0);
    }, [hasQueue, setBottomInset]);

    // Don't render if nothing in queue
    if (!hasQueue) {
        return null;
    }

    return (
        <div className="fixed bottom-0 left-0 right-0 pointer-events-none z-[40] flex flex-col items-center justify-end pb-6">
             <div className="relative w-full max-w-md mx-auto pointer-events-auto">
                 {/* FAB Container - Absolute positioned relative to the wrapper */}
                 {!isLibrary && (
                     <div className="absolute bottom-20 right-4 z-50">
                         <SatelliteFAB />
                     </div>
                 )}

                 {/* Pill Container */}
                 <div className="mb-4">
                     <CompassPill variant={isLibrary ? 'summary' : 'active'} />
                 </div>
             </div>
        </div>
    );
};
