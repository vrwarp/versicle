import React from 'react';
import { BookCard } from '../BookCard';
import type { ViewProps } from './types';

export const ClassicGrid: React.FC<ViewProps> = ({ books }) => {
    return (
        <div className="h-full overflow-y-auto pb-20 p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {books.map(book => (
                    <div key={book.id} className="w-full">
                        <BookCard book={book} />
                    </div>
                ))}
            </div>
        </div>
    );
};
