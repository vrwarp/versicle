import React, { useEffect, useState } from 'react';
import { useUIStore } from '../../store/useUIStore';
import { useTTSStore } from '../../store/useTTSStore';
import { useLocation } from 'react-router-dom';
import { Play, Pause, X, SkipBack, SkipForward, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { dbService } from '../../db/DBService';

export const MiniPlayer: React.FC = () => {
    const location = useLocation();
    const isReaderView = location.pathname.startsWith('/read/');

    const { isPlaying, status, queue, currentIndex, play, pause, stop, seek, jumpTo } = useTTSStore();
    const { setAudioPanelOpen } = useUIStore();

    const [localCoverUrl, setLocalCoverUrl] = useState<string | null>(null);

    const currentItem = queue[currentIndex];

    useEffect(() => {
        let url: string | null = null;
        const loadCover = async () => {
            if (currentItem?.bookId) {
                try {
                    const metadata = await dbService.getBookMetadata(currentItem.bookId);
                    if (metadata?.coverBlob) {
                        url = URL.createObjectURL(metadata.coverBlob);
                        setLocalCoverUrl(url);
                    } else {
                        setLocalCoverUrl(null);
                    }
                } catch (e) {
                    console.error("Failed to load cover for mini player", e);
                    setLocalCoverUrl(null);
                }
            } else {
                setLocalCoverUrl(null);
            }
        };

        loadCover();

        return () => {
            if (url) URL.revokeObjectURL(url);
        };
    }, [currentItem?.bookId]);

    // Logging state for debugging
    useEffect(() => {
        console.log(`[MiniPlayer] Render Check: Status=${status}, ReaderView=${isReaderView}, HasItem=${!!currentItem}, Path=${location.pathname}`);
    }, [status, isReaderView, currentItem, location.pathname]);

    if (status === 'stopped' || status === 'completed') return null;
    // Show ONLY in Reader View
    if (!isReaderView) return null;

    if (!currentItem) return null;

    const { bookTitle, title } = currentItem;
    const coverUrl = localCoverUrl || currentItem.coverUrl;

    const displayText = currentItem.text || "No text available";
    const truncatedText = displayText.length > 40 ? displayText.substring(0, 40) + '...' : displayText;

    return (
        <div
            className="fixed bottom-0 left-0 right-0 h-[80px] bg-background border-t border-border shadow-lg z-40 flex items-center px-4 gap-3 transition-transform duration-300 ease-out transform translate-y-0"
            data-testid="mini-player"
            onClick={(e: React.MouseEvent) => {
                 if ((e.target as HTMLElement).closest('button')) return;
                 setAudioPanelOpen(true);
            }}
        >
             {/* Thumbnail */}
             <div className="h-12 w-8 bg-muted shrink-0 rounded overflow-hidden relative shadow-sm hidden sm:block">
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
             <div className="flex items-center gap-1 shrink-0">
                 {/* Prev Sentence */}
                 <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); jumpTo(Math.max(0, currentIndex - 1)); }} title="Previous Sentence">
                     <ChevronLeft className="h-4 w-4" />
                 </Button>

                 {/* Seek Back */}
                 <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); seek(-15); }} title="Rewind 15s">
                     <SkipBack className="h-4 w-4" />
                 </Button>

                 {/* Play/Pause */}
                 <Button
                    variant="default"
                    size="icon"
                    className="h-10 w-10 rounded-full mx-1"
                    onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        isPlaying ? pause() : play();
                    }}
                    aria-label={isPlaying ? "Pause" : "Play"}
                    data-testid="mini-player-play-pause"
                 >
                     {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
                 </Button>

                 {/* Seek Forward */}
                 <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); seek(15); }} title="Forward 15s">
                     <SkipForward className="h-4 w-4" />
                 </Button>

                 {/* Next Sentence */}
                 <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); jumpTo(currentIndex + 1); }} title="Next Sentence">
                     <ChevronRight className="h-4 w-4" />
                 </Button>

                 {/* Close */}
                 <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive ml-2"
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
