import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ViewProps } from './types';
import type { BookMetadata } from '../../../types/db';

const CoverItem = ({ book }: { book: BookMetadata }) => {
    const navigate = useNavigate();
    const [coverUrl, setCoverUrl] = useState<string | null>(null);

    useEffect(() => {
        let url: string | null = null;
        if (book.coverBlob) {
            url = URL.createObjectURL(book.coverBlob);
            setCoverUrl(url);
        }
        return () => { if (url) URL.revokeObjectURL(url); };
    }, [book.coverBlob]);

    return (
        <div
            className="aspect-[2/3] rounded-md overflow-hidden shadow-sm hover:shadow-lg transition-all hover:scale-105 cursor-pointer bg-muted relative group"
            onClick={() => navigate(`/read/${book.id}`)}
            title={`${book.title} by ${book.author}`}
        >
            {coverUrl ? (
                <img src={coverUrl} alt={book.title} className="w-full h-full object-cover" />
            ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground p-2 text-center">
                    {book.title}
                </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                {book.title}
            </div>
        </div>
    );
};

export const CoverOnly: React.FC<ViewProps> = ({ books }) => {
    return (
        <div className="h-full overflow-y-auto pb-20 p-4">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                {books.map(book => (
                    <CoverItem key={book.id} book={book} />
                ))}
            </div>
        </div>
    );
};
