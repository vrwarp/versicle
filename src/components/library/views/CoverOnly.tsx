import React, { useMemo, useEffect, useState } from 'react';
import * as ReactWindow from 'react-window';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Grid = (ReactWindow as any).FixedSizeGrid;
import type { ViewProps } from './types';
import { useNavigate } from 'react-router-dom';
import type { BookMetadata } from '../../../types/db';

const CARD_WIDTH = 120;
const RATIO = 1.5;
const CARD_HEIGHT = CARD_WIDTH * RATIO;
const GAP = 16;

const CoverItem = ({ book, style }: { book: BookMetadata, style: React.CSSProperties }) => {
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
            style={style}
            className="rounded-md overflow-hidden shadow-sm hover:shadow-lg transition-all hover:scale-105 cursor-pointer bg-muted relative group"
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
            {/* Tooltip on hover (simple overlay) */}
            <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                {book.title}
            </div>
        </div>
    );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Cell = ({ columnIndex, rowIndex, style, data }: any) => {
    const { books, columnCount } = data;
    const index = rowIndex * columnCount + columnIndex;
    if (index >= books.length) return <div style={style} />;
    const book = books[index];

    return (
        <CoverItem
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

export const CoverOnly: React.FC<ViewProps> = ({ books, dimensions }) => {
    const columnCount = Math.floor(dimensions.width / (CARD_WIDTH + GAP)) || 3;
    const rowCount = Math.ceil(books.length / columnCount);
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
            className="pb-20"
        >
            {Cell}
        </Grid>
    );
};
