import React from 'react';
import { useUIStore } from '../../store/useUIStore';
import { useTTSStore } from '../../store/useTTSStore';
import { useLocation } from 'react-router-dom';
import { Play, Pause, X } from 'lucide-react';
import { Button } from '../ui/Button';

export const MiniPlayer: React.FC = () => {
    const location = useLocation();
    const isReaderView = location.pathname.startsWith('/read/');

    const { isPlaying, status, queue, currentIndex, play, pause, stop } = useTTSStore();
    const { setAudioPanelOpen } = useUIStore();

    if (status === 'stopped' || status === 'completed') return null;
    if (isReaderView) return null;

    const currentItem = queue[currentIndex];
    if (!currentItem) return null;

    const { bookTitle, title, coverUrl } = currentItem;
    const displayText = currentItem.text || "No text available";
    const truncatedText = displayText.length > 60 ? displayText.substring(0, 60) + '...' : displayText;

    return (
        <div
            className="fixed bottom-0 left-0 right-0 h-[70px] bg-background border-t border-border shadow-lg z-40 flex items-center px-4 gap-4 transition-transform duration-300 ease-out transform translate-y-0"
            data-testid="mini-player"
            onClick={(e: React.MouseEvent) => {
                 if ((e.target as HTMLElement).closest('button')) return;
                 setAudioPanelOpen(true);
            }}
        >
             {/* Thumbnail */}
             <div className="h-12 w-8 bg-muted shrink-0 rounded overflow-hidden relative shadow-sm">
                 {coverUrl ? (
                     <img src={coverUrl} alt={bookTitle || "Book Cover"} className="w-full h-full object-cover" />
                 ) : (
                     <div className="w-full h-full flex items-center justify-center bg-secondary">
                        <span className="text-[8px] text-muted-foreground text-center leading-none p-1">{bookTitle || "Cover"}</span>
                     </div>
                 )}
                 {/* Live Indicator */}
                 {isPlaying && (
                     <div className="absolute bottom-0 right-0 w-3 h-3 bg-primary rounded-full animate-pulse border-2 border-background" />
                 )}
             </div>

             {/* Content */}
             <div className="flex-1 min-w-0 flex flex-col justify-center cursor-pointer">
                 <div className="text-xs font-medium text-muted-foreground truncate">
                     {bookTitle ? `${bookTitle} • ${title || 'Chapter'}` : (title || 'Chapter')}
                 </div>
                 <div className="text-sm font-semibold text-foreground truncate">
                     {truncatedText}
                 </div>
             </div>

             {/* Controls */}
             <div className="flex items-center gap-2 shrink-0">
                 <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 rounded-full"
                    onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        isPlaying ? pause() : play();
                    }}
                    aria-label={isPlaying ? "Pause" : "Play"}
                    data-testid="mini-player-play-pause"
                 >
                     {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
                 </Button>

                 <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        stop();
                    }}
                    aria-label="Stop"
                    data-testid="mini-player-close"
                 >
                     <X className="h-4 w-4" />
                 </Button>
             </div>
        </div>
    );
};
