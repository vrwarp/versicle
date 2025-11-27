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
        navigation: Promise<unknown>;
        cover: Promise<string>;
      };
      archive: {
        createUrl(url: string, options?: Record<string, unknown>): Promise<string>;
        getBlob(url: string): Promise<Blob>;
      };
      coverUrl(): Promise<string | null>;
      renderTo(element: string | HTMLElement, options?: Record<string, unknown>): unknown;
      destroy(): void;
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
