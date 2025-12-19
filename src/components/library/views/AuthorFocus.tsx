import React, { useMemo } from 'react';
import type { ViewProps } from './types';
import { BookCard } from '../BookCard';
import { User } from 'lucide-react';

export const AuthorFocus: React.FC<ViewProps> = ({ books, dimensions }) => {
    const groupedBooks = useMemo(() => {
        const groups: Record<string, typeof books> = {};
        books.forEach(book => {
            const author = book.author || 'Unknown Author';
            if (!groups[author]) groups[author] = [];
            groups[author].push(book);
        });
        return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
    }, [books]);

    return (
        <div
            className="w-full h-full overflow-y-auto pb-20 px-4"
            style={{ height: dimensions.height }}
        >
            <div className="space-y-12 py-8">
                {groupedBooks.map(([author, authorBooks]) => (
                    <div key={author} className="space-y-4">
                        <div className="flex items-center gap-4 border-b border-border pb-2">
                            <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                                <User className="w-6 h-6 text-muted-foreground" />
                            </div>
                            <h2 className="text-2xl font-bold text-foreground">{author}</h2>
                            <span className="text-sm text-muted-foreground">
                                {authorBooks.length} {authorBooks.length === 1 ? 'book' : 'books'}
                            </span>
                        </div>

                        {/* Horizontal List */}
                        <div className="flex gap-6 overflow-x-auto pb-6 snap-x snap-mandatory px-2">
                            {authorBooks.map(book => (
                                <div key={book.id} className="min-w-[200px] w-[200px] snap-center">
                                    <BookCard book={book} />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
