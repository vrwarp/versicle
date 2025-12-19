import React, { useMemo } from 'react';
import * as ReactWindow from 'react-window';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const List = (ReactWindow as any).FixedSizeList;
import { MinimalRowView } from './components/MinimalRowView';
import type { ViewProps } from './types';

const ROW_HEIGHT = 72;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Row = ({ index, style, data }: any) => {
    const book = data.books[index];
    if (!book) return null;
    return <MinimalRowView book={book} style={style} />;
};

export const MinimalList: React.FC<ViewProps> = ({ books, dimensions }) => {
    const itemData = useMemo(() => ({ books }), [books]);

    return (
        <List
            height={dimensions.height}
            itemCount={books.length}
            itemSize={ROW_HEIGHT}
            width={dimensions.width}
            itemData={itemData}
            className="pb-20"
        >
            {Row}
        </List>
    );
};
