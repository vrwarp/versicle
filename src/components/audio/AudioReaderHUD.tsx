import React, { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderUIStore } from '../../store/useReaderUIStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProgressStore } from '../../store/useProgressStore';
import { useShallow } from 'zustand/react/shallow';
import { CompassPill } from '../ui/CompassPill';
import { SatelliteFAB } from './SatelliteFAB';

export const AudioReaderHUD: React.FC = () => {
    const { queue, isPlaying, pause } = useTTSStore(useShallow(state => ({
        queue: state.queue,
        isPlaying: state.isPlaying,
        pause: state.pause
    })));
    const immersiveMode = useReaderUIStore(state => state.immersiveMode);

    // Subscribe to both Inventory and Progress
    const booksMap = useLibraryStore(state => state.books);
    const progressMap = useProgressStore();

    const location = useLocation();
    const navigate = useNavigate();

    // Check if we are in Library (root path)
    const isLibrary = location.pathname === '/';

    // Auto-pause when entering library (as per spec)
    useEffect(() => {
        if (isLibrary && isPlaying) {
            pause();
        }
    }, [isLibrary, isPlaying, pause]);

    // Derived last read book
    const lastReadBook = useMemo(() => {
        if (!booksMap || !progressMap) return null;

        // Find progress entry with max timestamp
        const progressEntries = Object.values(progressMap);
        if (progressEntries.length === 0) return null;

        const lastProgress = progressEntries.sort((a, b) => b.lastRead - a.lastRead)[0];
        if (!lastProgress) return null;

        // Match with Inventory
        const book = booksMap[lastProgress.bookId];
        if (!book) return null; // Orphaned progress

        return {
            id: book.bookId,
            title: book.customTitle || "Unknown Book",
            progress: lastProgress.percentage
        };
    }, [booksMap, progressMap]);

    // Show last read book if in library and not playing audio
    const showLastRead = isLibrary && !isPlaying && lastReadBook;

    // Don't render if nothing in queue AND no last read book in library
    if ((!queue || queue.length === 0) && !showLastRead) {
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
                     {showLastRead ? (
                        <CompassPill
                            key="summary"
                            variant="summary"
                            title={lastReadBook!.title}
                            subtitle="Continue Reading"
                            progress={(lastReadBook!.progress || 0) * 100}
                            onClick={() => navigate(`/read/${lastReadBook!.id}`)}
                        />
                     ) : (
                        <CompassPill
                            key={immersiveMode ? 'compact' : (isLibrary ? 'summary' : 'active')}
                            variant={immersiveMode ? 'compact' : (isLibrary ? 'summary' : 'active')}
                        />
                     )}
                 </div>
             </div>
        </div>
    );
};
