import React from 'react';
import { BookCard } from '../BookCard';
import type { ViewProps } from './types';

export const CompactGrid: React.FC<ViewProps> = ({ books }) => {
    return (
        <div className="h-full overflow-y-auto pb-20 p-2 compact-grid-view">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                {books.map(book => (
                    <div key={book.id} className="text-xs">
                        <BookCard book={book} />
                    </div>
                ))}
            </div>
        </div>
    );
};
