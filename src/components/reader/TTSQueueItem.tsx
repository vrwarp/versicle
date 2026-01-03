import { memo, forwardRef } from 'react';
import type { TTSQueueItem as TTSQueueItemType } from '../../lib/tts/AudioPlayerService';
import { cn } from '../../lib/utils';

interface TTSQueueItemProps {
    item: TTSQueueItemType;
    index: number;
    isActive: boolean;
    onJump: (index: number) => void;
}

/**
 * Individual queue item component.
 * Memoized to prevent re-renders of inactive items when the current index changes.
 */
export const TTSQueueItem = memo(forwardRef<HTMLButtonElement, TTSQueueItemProps>(
    ({ item, index, isActive, onJump }, ref) => {
        return (
            <button
                data-testid={`tts-queue-item-${index}`}
                ref={ref}
                onClick={() => onJump(index)}
                className={cn(
                    "text-left text-sm p-2 rounded transition-all duration-200 w-full",
                    isActive
                        ? "bg-primary/20 text-foreground border-l-4 border-primary font-medium shadow-sm"
                        : "text-muted-foreground opacity-60 hover:opacity-100 hover:bg-muted/10",
                    item.isSkipped && "opacity-40 hover:opacity-60 bg-muted/5"
                )}
            >
                <p className={cn("line-clamp-2", item.isSkipped && "line-through decoration-muted-foreground/50")}>
                    {item.text}
                </p>
                {item.isSkipped && <span className="text-xs italic ml-1 block mt-0.5">Skipped</span>}
            </button>
        );
    }
));

TTSQueueItem.displayName = 'TTSQueueItem';
