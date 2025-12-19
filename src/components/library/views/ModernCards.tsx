import React, { useMemo } from 'react';
import * as ReactWindow from 'react-window';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Grid = (ReactWindow as any).FixedSizeGrid;
import { ModernCardView } from './components/ModernCardView';
import type { ViewProps } from './types';

const CARD_WIDTH = 260; // Wider
const CARD_HEIGHT = 380; // Taller
const GAP = 32; // More breathing room

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModernGridCell = ({ columnIndex, rowIndex, style, data }: any) => {
    const { books, columnCount } = data;
    const index = rowIndex * columnCount + columnIndex;
    if (index >= books.length) return <div style={style} />;
    const book = books[index];

    return (
        <ModernCardView
            book={book}
            style={{
                ...style,
                left: Number(style.left) + GAP / 2,
                top: Number(style.top) + GAP / 2,
                width: Number(style.width) - GAP,
                height: Number(style.height) - GAP,
            }}
        />
    );
}

export const ModernCards: React.FC<ViewProps> = ({ books, dimensions }) => {
    const columnCount = Math.floor(dimensions.width / (CARD_WIDTH + GAP)) || 1;
    const rowCount = Math.ceil(books.length / columnCount) + 1;
    const columnWidth = Math.floor(dimensions.width / columnCount);

    // Center the grid if possible by adjusting width?
    // react-window expects fixed width. We use columnWidth to fill space.

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
            className="pb-20"
        >
            {ModernGridCell}
        </Grid>
    );
};
