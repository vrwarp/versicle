import React from 'react';
import { MinimalRowView } from './components/MinimalRowView';
import type { ViewProps } from './types';

export const MinimalList: React.FC<ViewProps> = ({ books }) => {
    return (
        <div className="h-full overflow-y-auto pb-20">
            <div className="flex flex-col divide-y divide-border/20">
                {books.map(book => (
                    <MinimalRowView key={book.id} book={book} style={{}} />
                ))}
            </div>
        </div>
    );
};
