import React from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { useUIStore } from '../../store/useUIStore';
import { AudioPlayerService } from '../../lib/tts/AudioPlayerService';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export const CompassPill: React.FC = () => {
    const {
        currentChapterTitle,
        currentChapterIndex,
        chapterProgress,
        isPlaying,
        status
    } = useTTSStore();

    const { setAudioPanelOpen } = useUIStore();
    const player = AudioPlayerService.getInstance();

    // Helper to format remaining time (simulated for now based on progress)
    // Real estimation would require words count or duration.
    // Spec says "-12:45 remaining". We'll fallback to percentage if unknown.
    // For now, we display percentage as a proxy for progress until we have duration.
    const progressPercent = Math.round((chapterProgress || 0) * 100);

    // Handle Navigation
    const handlePrev = (e: React.MouseEvent) => {
        e.stopPropagation();
        player.prev();
    };

    const handleNext = (e: React.MouseEvent) => {
        e.stopPropagation();
        player.next();
    };

    const handleCenterClick = () => {
        setAudioPanelOpen(true);
    };

    // Derived Display Data
    const displayTitle = currentChapterTitle || `Chapter ${currentChapterIndex + 1}`;
    const displaySubtitle = `${progressPercent}% completed`; // Fallback for time remaining

    return (
        <div
            className="fixed bottom-6 left-0 right-0 mx-4 md:mx-auto max-w-md h-14 z-40 flex items-center justify-between rounded-full overflow-hidden backdrop-blur-md bg-background/80 border border-white/10 shadow-lg select-none"
            onClick={handleCenterClick}
        >
            {/* Ambient Progress Bar */}
            <div
                className="absolute inset-y-0 left-0 bg-primary/10 transition-all duration-500 ease-out pointer-events-none"
                style={{ width: `${progressPercent}%` }}
            />

            {/* Left Anchor */}
            <button
                onClick={handlePrev}
                className="relative z-10 h-full px-4 flex items-center justify-center hover:bg-white/5 active:bg-white/10 transition-colors"
                aria-label="Previous Chapter"
            >
                <ChevronLeft className="w-6 h-6 text-foreground/80" />
            </button>

            {/* Center Narrative Box */}
            <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center overflow-hidden px-2">
                <span className="text-xs font-bold uppercase tracking-wider text-foreground truncate w-full">
                    {displayTitle}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                    {displaySubtitle}
                </span>
            </div>

            {/* Right Anchor */}
            <button
                onClick={handleNext}
                className="relative z-10 h-full px-4 flex items-center justify-center hover:bg-white/5 active:bg-white/10 transition-colors"
                aria-label="Next Chapter"
            >
                <ChevronRight className="w-6 h-6 text-foreground/80" />
            </button>
        </div>
    );
};
