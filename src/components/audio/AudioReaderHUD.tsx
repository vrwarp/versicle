import React, { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderUIStore } from '../../store/useReaderUIStore';
import { useAllBooks } from '../../store/useLibraryStore';
import { useReadingStateStore } from '../../store/useReadingStateStore';
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
    const books = useAllBooks();
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

    const lastReadBook = useMemo(() => {
        if (!books || books.length === 0) return null;
        const progress = useReadingStateStore.getState().progress;
        const startedBooks = books.filter(b => {
            const bookProgress = progress[b.bookId];
            return bookProgress?.lastRead && bookProgress.percentage > 0;
        });
        if (startedBooks.length === 0) return null;
        return startedBooks.sort((a, b) => {
            const aProgress = progress[a.bookId];
            const bProgress = progress[b.bookId];
            return (bProgress?.lastRead || 0) - (aProgress?.lastRead || 0);
        })[0];
    }, [books]);

    // Show last read book if in library and not playing audio
    const showLastRead = isLibrary && !isPlaying && lastReadBook;

    // Don't render if nothing in queue AND no last read book in library
    // If showLastRead is true, we render.
    // If showLastRead is false, we only render if queue has items.
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
                            progress={(useReadingStateStore.getState().progress[lastReadBook!.bookId]?.percentage || 0) * 100}
                            onClick={() => navigate(`/read/${lastReadBook!.bookId}`)}
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
