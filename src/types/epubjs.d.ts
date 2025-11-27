declare module 'epubjs' {
    export interface BookOptions {
      openAs?: string;
      encoding?: string;
      replacements?: string;
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
    }

    export interface Rendition {
      display(target?: string): Promise<void>;
      next(): Promise<void>;
      prev(): Promise<void>;
      on(event: string, listener: (args: unknown) => void): void;
      themes: {
        register(name: string, styles: Record<string, unknown> | string): void;
        select(name: string): void;
        fontSize(size: string): void;
      };
    }

    export interface Navigation {
        toc: NavItem[];
    }

    export interface NavItem {
        id: string;
        href: string;
        label: string;
        subitems?: NavItem[];
        parent?: string;
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

    function ePub(data: string | ArrayBuffer, options?: BookOptions): Book;
    export default ePub;
  }
