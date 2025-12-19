import React, { useMemo } from 'react';
import * as ReactWindow from 'react-window';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Grid = (ReactWindow as any).FixedSizeGrid;
import { BookCard } from '../BookCard';
import type { ViewProps } from './types';

const CARD_WIDTH = 200;
const CARD_HEIGHT = 320;
const GAP = 24;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GridCell = ({ columnIndex, rowIndex, style, data }: any) => {
    const { books, columnCount } = data;
    const index = rowIndex * columnCount + columnIndex;
    if (index >= books.length) return <div style={style} />;
    const book = books[index];

    return (
        <div style={{
            ...style,
            left: Number(style.left) + GAP / 2,
            top: Number(style.top) + GAP / 2,
            width: Number(style.width) - GAP,
            height: Number(style.height) - GAP,
        }}>
           <BookCard book={book} />
        </div>
    );
}

export const ClassicGrid: React.FC<ViewProps> = ({ books, dimensions }) => {
    const columnCount = Math.floor(dimensions.width / (CARD_WIDTH + GAP)) || 1;
    const rowCount = Math.ceil(books.length / columnCount) + 1; // +1 for spacer
    const columnWidth = Math.floor(dimensions.width / columnCount);

    const itemData = useMemo(() => ({ books, columnCount }), [books, columnCount]);

    return (
        <Grid
            columnCount={columnCount}
            columnWidth={columnWidth}
            height={dimensions.height}
            rowCount={rowCount}
            rowHeight={CARD_HEIGHT + GAP}
            width={dimensions.width}
            itemData={itemData}
            className="pb-20" // Extra padding for bottom
        >
            {GridCell}
        </Grid>
    );
};
