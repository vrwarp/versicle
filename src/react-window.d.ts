declare module 'react-window' {
  import * as React from 'react';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface ListChildComponentProps<T = any> {
    index: number;
    style: React.CSSProperties;
    data?: T;
    isScrolling?: boolean;
  }

  export type ListChildComponent<T = unknown> = React.ComponentType<ListChildComponentProps<T>>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface FixedSizeListProps<T = any> {
    children: ListChildComponent<T>;
    className?: string;
    height: number | string;
    itemCount: number;
    itemSize: number;
    layout?: 'vertical' | 'horizontal';
    width: number | string;
    itemData?: T;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    itemKey?: (index: number, data: T) => any;
    overscanCount?: number;
    onItemsRendered?: (props: {
      overscanStartIndex: number;
      overscanStopIndex: number;
      visibleStartIndex: number;
      visibleStopIndex: number;
    }) => void;
    onScroll?: (props: {
      scrollDirection: 'forward' | 'backward';
      scrollOffset: number;
      scrollUpdateWasRequested: boolean;
    }) => void;
    outerElementType?: React.ElementType;
    innerElementType?: React.ElementType;
    style?: React.CSSProperties;
    useIsScrolling?: boolean;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export class FixedSizeList<T = any> extends React.Component<FixedSizeListProps<T>> {
    scrollTo(scrollOffset: number): void;
    scrollToItem(index: number, align?: 'auto' | 'smart' | 'center' | 'end' | 'start'): void;
  }

  // Alias List to FixedSizeList or similar if they share props
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export class List<T = any> extends FixedSizeList<T> {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  export class Grid<T = any> extends React.Component<any> {} // Define Grid properly if used
}
