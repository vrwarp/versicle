import React from 'react';
import { ModernCardView } from './components/ModernCardView';
import type { ViewProps } from './types';

export const ModernCards: React.FC<ViewProps> = ({ books }) => {
    return (
        <div className="h-full overflow-y-auto pb-20 p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-8">
                {books.map(book => (
                    <div key={book.id}>
                        <ModernCardView book={book} />
                    </div>
                ))}
            </div>
        </div>
    );
};
