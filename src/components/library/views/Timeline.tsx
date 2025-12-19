import React, { useMemo } from 'react';
import type { ViewProps } from './types';
import { BookCard } from '../BookCard';
import { cn } from '../../../lib/utils';

export const Timeline: React.FC<ViewProps> = ({ books, dimensions }) => {
    const sortedBooks = useMemo(() => {
        return [...books].sort((a, b) => b.addedAt - a.addedAt);
    }, [books]);

    return (
        <div
            className="w-full h-full overflow-y-auto pb-20 px-4 relative"
            style={{ height: dimensions.height }}
        >
            {/* Central Line */}
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-border transform -translate-x-1/2" />

            <div className="max-w-3xl mx-auto py-8 space-y-12 relative">
                {sortedBooks.map((book, index) => {
                    const isEven = index % 2 === 0;
                    const date = new Date(book.addedAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    });

                    return (
                        <div key={book.id} className={cn(
                            "relative flex items-center justify-between w-full",
                            isEven ? "flex-row" : "flex-row-reverse"
                        )}>
                            {/* Content Side */}
                            <div className="w-[45%]">
                                <BookCard book={book} />
                            </div>

                            {/* Dot on Line */}
                            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary border-4 border-background z-10 shadow" />

                            {/* Date Side */}
                            <div className={cn(
                                "w-[45%] flex items-center text-muted-foreground font-medium",
                                isEven ? "justify-start pl-4" : "justify-end pr-4"
                            )}>
                                {date}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
