import React from 'react';
import { BookCard } from '../BookCard';
import type { ViewProps } from './types';

export const MasonryGrid: React.FC<ViewProps> = ({ books, dimensions }) => {
    // CSS Columns Masonry
    // We don't use dimensions.height for windowing here, we just scroll the container.
    // The container in LibraryView has ref but this component will be inside it?
    // LibraryView passes dimensions but the parent container handles scroll?
    // LibraryView uses `react-window` Grid usually.
    // If we return a standard div, it will overflow the container.
    // We need to ensure the parent container allows scrolling if we don't use react-window.
    // But LibraryView has `overflow: hidden` usually because it expects virtualization?
    // Let's check LibraryView.tsx again.

    return (
        <div
            className="w-full h-full overflow-y-auto pb-20 px-4"
            style={{ height: dimensions.height }}
        >
            <div className="columns-2 md:columns-3 lg:columns-4 gap-6 space-y-6">
                {books.map((book) => (
                    <div key={book.id} className="break-inside-avoid">
                        <BookCard book={book} />
                    </div>
                ))}
            </div>
        </div>
    );
};
