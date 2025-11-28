import React, { useEffect, useRef } from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { AudioPlayerService } from '../../lib/tts/AudioPlayerService';

export const TTSQueue: React.FC = () => {
    const { isPlaying, activeCfi } = useTTSStore();
    const service = AudioPlayerService.getInstance();
    const { items, currentIndex } = service.getQueue();
    const activeRef = useRef<HTMLButtonElement>(null);

    // Scroll to active item when it changes
    useEffect(() => {
        if (activeRef.current) {
            activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [currentIndex, isPlaying]); // Trigger on index change

    // Force re-render if queue updates?
    // Since queue is not in store, we might not re-render automatically if queue changes but index doesn't.
    // However, usually queue changes imply index reset or we just read it on render.
    // Ideally we should sync queue to store or subscribe to service changes.
    // For now, let's assume parent re-renders or we use a hack to force update.
    // Actually, `activeCfi` in store changes when index changes, so that triggers re-render.

    if (items.length === 0) {
        return <div className="p-4 text-sm text-gray-500 text-center">No queue available</div>;
    }

    return (
        <div className="flex-1 overflow-y-auto">
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {items.map((item, index) => {
                    const isActive = index === currentIndex;
                    return (
                        <li key={index} className={`flex ${isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                            <button
                                ref={isActive ? activeRef : null}
                                onClick={() => {
                                    service.jumpTo(index);
                                }}
                                className={`flex-1 text-left p-3 text-sm ${
                                    isActive
                                    ? 'text-blue-700 dark:text-blue-300 font-medium'
                                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                                }`}
                            >
                                <span className="inline-block mr-2 text-xs text-gray-400 w-6 text-right">{index + 1}</span>
                                {item.text}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};
