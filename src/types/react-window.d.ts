declare module 'react-window' {
  import { Component, ComponentType, CSSProperties, Key, Ref } from 'react';

  export type CSSDirection = "ltr" | "rtl";
  export type ScrollDirection = "forward" | "backward";
  export type Align = "auto" | "smart" | "center" | "end" | "start";

  export interface GridChildComponentProps<T = any> {
      columnIndex: number;
      rowIndex: number;
      style: CSSProperties;
      data: T;
      isScrolling?: boolean | undefined;
  }

  export interface GridProps<T = any> {
      // In 2.2.3, cellComponent seems to be used instead of children for the item renderer?
      // Or children is the legacy way? The error said cellComponent is missing.
      children?: ComponentType<GridChildComponentProps<T>>;
      cellComponent?: ComponentType<any>; // Using any to match the loose typing in the file for now, or tighten it up
      cellProps?: any; // The custom props passed to the cell component
      className?: string;
      columnCount: number;
      columnWidth: number | ((index: number) => number);
      height: number;
      rowCount: number;
      rowHeight: number | ((index: number) => number);
      width: number;
      direction?: CSSDirection;
      itemData?: T;
      innerElementType?: any;
      innerRef?: any;
      outerElementType?: any;
      outerRef?: any;
      style?: CSSProperties;
      useIsScrolling?: boolean;
      onItemsRendered?: (props: any) => any;
      onScroll?: (props: any) => any;
      ref?: Ref<any>;
  }

  export class Grid<T = any> extends Component<GridProps<T>> {
      scrollTo(params: { scrollLeft?: number; scrollTop?: number }): void;
      scrollToItem(params: {
          align?: Align;
          columnIndex?: number;
          rowIndex?: number;
      }): void;
  }

  export interface ListChildComponentProps<T = any> {
      index: number;
      style: CSSProperties;
      data: T;
      isScrolling?: boolean | undefined;
  }

  export interface ListProps<T = any> {
      children?: ComponentType<ListChildComponentProps<T>>;
      cellComponent?: ComponentType<any>;
      cellProps?: any;
      className?: string;
      height: number | string;
      itemCount: number;
      itemSize: number | ((index: number) => number);
      width: number | string;
      direction?: CSSDirection | "vertical" | "horizontal";
      layout?: "vertical" | "horizontal";
      itemData?: T;
      innerElementType?: any;
      innerRef?: any;
      outerElementType?: any;
      outerRef?: any;
      style?: CSSProperties;
      useIsScrolling?: boolean;
      onItemsRendered?: (props: any) => any;
      onScroll?: (props: any) => any;
      ref?: Ref<any>;
  }

  export class List<T = any> extends Component<ListProps<T>> {
      scrollTo(scrollOffset: number): void;
      scrollToItem(index: number, align?: Align): void;
  }

  export { Grid as FixedSizeGrid };
  export { Grid as VariableSizeGrid };
  export { List as FixedSizeList };
  export { List as VariableSizeList };
}
