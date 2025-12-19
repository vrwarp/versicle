import React, { useMemo } from 'react';
import * as ReactWindow from 'react-window';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Grid = (ReactWindow as any).FixedSizeGrid;
import { BookCard } from '../BookCard';
import type { ViewProps } from './types';

const CARD_WIDTH = 140;
const CARD_HEIGHT = 240;
const GAP = 16;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CompactCell = ({ columnIndex, rowIndex, style, data }: any) => {
    const { books, columnCount } = data;
    const index = rowIndex * columnCount + columnIndex;
    if (index >= books.length) return <div style={style} />;
    const book = books[index];

    // We scale down the BookCard using CSS transform or just constrained width
    // BookCard is responsive, so constrained width works.
    // We might want to override font sizes via CSS in a parent class?
    return (
        <div style={{
            ...style,
            left: Number(style.left) + GAP / 2,
            top: Number(style.top) + GAP / 2,
            width: Number(style.width) - GAP,
            height: Number(style.height) - GAP,
        }} className="text-xs">
           <BookCard book={book} />
        </div>
    );
}

export const CompactGrid: React.FC<ViewProps> = ({ books, dimensions }) => {
    const columnCount = Math.floor(dimensions.width / (CARD_WIDTH + GAP)) || 2;
    const rowCount = Math.ceil(books.length / columnCount) + 1;
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
            className="pb-20 compact-grid-view"
        >
            {CompactCell}
        </Grid>
    );
};
