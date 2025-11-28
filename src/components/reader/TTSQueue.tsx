import React, { useEffect, useRef } from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { cn } from '../../lib/utils';

export const TTSQueue: React.FC = () => {
    const { queue, currentIndex, jumpTo } = useTTSStore();
    const activeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (activeRef.current) {
            activeRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
            });
        }
    }, [currentIndex]); // Scroll when index changes

    if (queue.length === 0) {
        return <div className="p-4 text-center text-gray-500 text-xs dark:text-gray-400">No text available.</div>;
    }

    return (
        <div className="flex flex-col gap-1 mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
            <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Queue</h4>
            <div className="flex flex-col gap-1 max-h-60 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
                {queue.map((item, index) => {
                    const isActive = index === currentIndex;
                    return (
                        <button
                            key={index}
                            ref={isActive ? activeRef : null}
                            onClick={() => jumpTo(index)}
                            className={cn(
                                "text-left text-xs p-2 rounded transition-colors duration-200 w-full",
                                isActive
                                    ? "bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 border-l-2 border-blue-500"
                                    : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                            )}
                        >
                            <p className="line-clamp-2">{item.text}</p>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
