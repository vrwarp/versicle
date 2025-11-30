declare module 'epubjs' {
    export interface BookOptions {
      openAs?: string;
      encoding?: string;
      replacements?: string;
    }

    export interface Metadata {
      title: string;
      creator: string;
      description: string;
      pubdate: string;
      publisher: string;
      identifier: string;
      language: string;
      rights: string;
      modified_date: string;
      layout: string;
      orientation: string;
      spread: string;
      direction: string;
    }

    export interface Location {
      start: {
        index: number;
        href: string;
        cfi: string;
        displayed: {
          page: number;
          total: number;
        };
      };
      end: {
        index: number;
        href: string;
        cfi: string;
        displayed: {
          page: number;
          total: number;
        };
      };
      atStart: boolean;
      atEnd: boolean;
    }

    export interface NavigationItem {
      id: string;
      href: string;
      label: string;
      subitems?: NavigationItem[];
      parent?: string;
    }

    export interface Navigation {
        toc: NavigationItem[];
        get(target: string): NavigationItem;
    }

    export interface Themes {
        register(name: string, styles: object | string): void;
        register(styles: object | string): void;
        select(name: string): void;
        fontSize(size: string): void;
        font(name: string): void;
    }

    export interface Rendition {
        settings: Record<string, unknown>;
        themes: Themes;
        hooks: {
            content: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                register(callback: (contents: any) => void): void;
            };
        };
        display(target?: string): Promise<void>;
        next(): Promise<void>;
        prev(): Promise<void>;
        currentLocation(): Location;
        on(event: 'relocated', listener: (location: Location) => void): void;
        on(event: 'selected', listener: (cfiRange: string, contents: unknown) => void): void;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        on(event: string, listener: (...args: any[]) => void): void;
        destroy(): void;
    }

    export interface Locations {
        generate(chars: number): Promise<string[]>;
        cfiFromPercentage(percentage: number): string;
        percentageFromCfi(cfi: string): number;
    }

    export interface Book {
      ready: Promise<void>;
      loaded: {
        metadata: Promise<Metadata>;
        navigation: Promise<Navigation>;
        cover: Promise<string>;
      };
      archive: {
        createUrl(url: string, options?: Record<string, unknown>): Promise<string>;
        getBlob(url: string): Promise<Blob>;
      };
      coverUrl(): Promise<string | null>;
      renderTo(element: string | HTMLElement, options?: Record<string, unknown>): Rendition;
      destroy(): void;
      locations: Locations;
      navigation: Navigation;
      spine: {
        get(target: string | number): unknown;
      }
    }

    function ePub(data: string | ArrayBuffer, options?: BookOptions): Book;
    export default ePub;
  }
