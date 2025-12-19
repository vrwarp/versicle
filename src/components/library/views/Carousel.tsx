import React from 'react';
import type { ViewProps } from './types';
import { ModernCardView } from './components/ModernCardView';

export const Carousel: React.FC<ViewProps> = ({ books, dimensions }) => {
    return (
        <div
            className="w-full h-full flex items-center overflow-x-auto snap-x snap-mandatory px-[50vw] pb-12"
            style={{ height: dimensions.height }}
        >
            <div className="flex gap-8 items-center h-full py-8">
                {books.map((book) => (
                    <div
                        key={book.id}
                        className="snap-center shrink-0 w-[280px] md:w-[320px] transition-transform duration-300 hover:scale-105"
                    >
                         <ModernCardView book={book} style={{ width: '100%' }} />
                    </div>
                ))}
            </div>
        </div>
    );
};
