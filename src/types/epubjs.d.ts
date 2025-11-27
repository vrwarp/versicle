declare module 'epubjs' {
  export class Book {
    constructor(url?: string | ArrayBuffer, options?: unknown);
    renderTo(element: string | HTMLElement, options?: unknown): Rendition;
    getRange(cfi: string): Range;
    spine: unknown;
    locations: unknown;
    coverUrl(): Promise<string>;
    loaded: {
      metadata: Promise<unknown>;
      navigation: Promise<unknown>;
      cover: Promise<string>;
    };
    archive: {
      createUrl(url: string, options?: unknown): Promise<string>;
      revokeUrl(url: string): void;
    };
    destroy(): void;
  }

  export class Rendition {
    display(target?: string): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    on(event: string, callback: unknown): void;
    off(event: string, callback: unknown): void;
    themes: {
      register(name: string, styles: unknown): void;
      select(name: string): void;
      fontSize(size: string): void;
    };
    annotations: {
      add(type: string, cfiRange: string, data?: unknown, callback?: unknown, className?: string): void;
      remove(cfiRange: string, type: string): void;
    };
    location: {
      start: {
        cfi: string;
        displayed: {
          page: number;
          total: number;
        };
      };
      end: {
        cfi: string;
      };
    };
    currentLocation(): unknown;
    getContents(): unknown[];
    destroy(): void;
  }

  export class CFI {
    constructor(range?: Range | string, cfi?: string);
    toString(): string;
  }

  function ePub(url?: string | ArrayBuffer, options?: unknown): Book;
  export default ePub;
}
