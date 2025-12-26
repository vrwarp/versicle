declare module 'react-window' {
  import { Component, ComponentType, CSSProperties, Ref } from 'react';

  export interface GridProps {
    className?: string;
    columnCount: number;
    columnWidth: number | ((index: number) => number);
    height: number;
    rowCount: number;
    rowHeight: number | ((index: number) => number);
    width: number;
    children: ComponentType<any>;
    itemData?: any;
    style?: CSSProperties;
    ref?: Ref<any>;
    onScroll?: (props: { scrollLeft: number; scrollTop: number }) => void;
    // Add other props as needed
    [key: string]: any;
  }

  export class Grid extends Component<GridProps> {
    scrollTo(params: { scrollLeft?: number; scrollTop?: number }): void;
    scrollToItem(params: { align?: string; columnIndex?: number; rowIndex?: number }): void;
  }

  export interface ListProps {
      className?: string;
      children: ComponentType<any>;
      height: number;
      itemCount: number;
      itemSize: number | ((index: number) => number);
      width: number | string;
      layout?: 'vertical' | 'horizontal';
      itemData?: any;
      style?: CSSProperties;
      ref?: Ref<any>;
      // Add other props as needed
      [key: string]: any;
  }

  export class List extends Component<ListProps> {
      scrollTo(scrollOffset: number): void;
      scrollToItem(index: number, align?: string): void;
  }
}
