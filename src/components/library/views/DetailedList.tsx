import React from 'react';
import { BookListItem } from '../BookListItem';
import type { ViewProps } from './types';

export const DetailedList: React.FC<ViewProps> = ({ books }) => {
    return (
        <div className="h-full overflow-y-auto pb-20">
            <div className="flex flex-col">
                {books.map(book => (
                    <div key={book.id} className="h-24">
                        <BookListItem book={book} style={{}} />
                    </div>
                ))}
            </div>
        </div>
    );
};
