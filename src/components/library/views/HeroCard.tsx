import React from 'react';
import { HeroCardView } from './components/HeroCardView';
import { BookCard } from '../BookCard';
import type { ViewProps } from './types';

export const HeroCard: React.FC<ViewProps> = ({ books }) => {
    if (books.length === 0) return null;
    const heroBook = books[0];
    const gridBooks = books.slice(1);

    return (
        <div className="h-full overflow-y-auto pb-20 p-4">
            <div className="mb-8">
                <HeroCardView book={heroBook} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                {gridBooks.map(book => (
                    <div key={book.id} className="w-full">
                        <BookCard book={book} />
                    </div>
                ))}
            </div>
        </div>
    );
};
