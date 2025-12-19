import React, { useMemo } from 'react';
import * as ReactWindow from 'react-window';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const List = (ReactWindow as any).VariableSizeList;
import { HeroCardView } from './components/HeroCardView';
import { BookCard } from '../BookCard';
import type { BookMetadata } from '../../../types/db';
import type { ViewProps } from './types';

const CARD_WIDTH = 200;
const GAP = 24;
const CARD_HEIGHT = 320;
const HERO_HEIGHT = 500; // Height for the hero section

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HeroViewRow = ({ index, style, data }: any) => {
    const { books, columnCount, columnWidth } = data;

    if (index === 0) {
        // Hero Section
        if (books.length === 0) return null;
        return (
            <div style={{ ...style, padding: 24, paddingBottom: 0 }}>
                <HeroCardView book={books[0]} />
            </div>
        );
    }

    // Grid Rows
    // index 1 corresponds to the first row of the grid (containing books starting at index 1)
    const gridRowIndex = index - 1;
    const startIndex = 1 + (gridRowIndex * columnCount);
    const rowBooks = books.slice(startIndex, startIndex + columnCount);

    return (
        <div style={{ ...style, display: 'flex', gap: GAP, paddingLeft: GAP, paddingRight: GAP }}>
            {rowBooks.map((book: BookMetadata) => (
                <div key={book.id} style={{ width: columnWidth - GAP, height: CARD_HEIGHT }}>
                    <BookCard book={book} />
                </div>
            ))}
        </div>
    );
};

export const HeroCard: React.FC<ViewProps> = ({ books, dimensions }) => {
    const columnCount = Math.floor(dimensions.width / (CARD_WIDTH + GAP)) || 1;
    // Count remaining books after the first one
    const remainingBooks = Math.max(0, books.length - 1);
    const gridRowCount = Math.ceil(remainingBooks / columnCount);
    // Total rows = 1 (Hero) + grid rows
    const itemCount = 1 + gridRowCount;

    const columnWidth = Math.floor(dimensions.width / columnCount);

    const getItemSize = (index: number) => {
        if (index === 0) return HERO_HEIGHT;
        return CARD_HEIGHT + GAP;
    };

    const itemData = useMemo(() => ({ books, columnCount, columnWidth }), [books, columnCount, columnWidth]);

    return (
        <List
            height={dimensions.height}
            itemCount={itemCount}
            itemSize={getItemSize}
            width={dimensions.width}
            itemData={itemData}
            className="pb-20"
        >
            {HeroViewRow}
        </List>
    );
};
