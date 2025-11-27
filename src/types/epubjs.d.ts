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
      spine: Spine;
    }

    export interface Spine {
      get(target: string | number): SpineItem;
      each(callback: (item: SpineItem) => void): void;
    }

    export interface SpineItem {
      href: string;
      id: string;
      index: number;
      canonical: string;
      url: string;
      cfiFromElement(el: Element): string;
      load(runPv: boolean): Promise<Document>;
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

    export interface Navigation {
      toc: NavItem[];
      get(target: string): NavItem;
    }

    export interface NavItem {
      id: string;
      href: string;
      label: string;
      subitems?: NavItem[];
      parent?: string;
    }

    export interface Rendition {
      display(target?: string): Promise<void>;
      next(): Promise<void>;
      prev(): Promise<void>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on(event: string, listener: (event: any) => void): void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      off(event: string, listener: (event: any) => void): void;
      themes: Themes;
      resize(width?: number | string, height?: number | string): void;
      destroy(): void;
      location: {
        start: Location;
        end: Location;
        atStart: boolean;
        atEnd: boolean;
      };
      hooks: {
        content: {
            register(callback: (contents: Contents) => void): void;
        }
      }
    }

    export interface Themes {
      register(name: string, url: string | object): void;
      select(name: string): void;
      fontSize(size: string): void;
      default(properties: object): void;
    }

    export interface Location {
      index: number;
      href: string;
      cfi: string;
      percentage: number;
      displayed: {
        page: number;
        total: number;
      };
    }

    export interface Contents {
        document: Document;
        content: HTMLElement;
    }

    function ePub(data: string | ArrayBuffer, options?: BookOptions): Book;
    export default ePub;
  }
