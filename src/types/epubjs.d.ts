declare module "epubjs" {
  export interface NavItem {
    id: string;
    href: string;
    label: string;
    subitems?: NavItem[];
  }

  export interface PackagingMetadata {
    title: string;
    creator: string;
    description?: string;
    publisher?: string;
    language?: string;
    rights?: string;
    date?: string;
    identifier?: string;
  }

  export interface Location {
    start: {
      index: number;
      href: string;
      displayed?: {
        page: number;
        total: number;
      };
    };
    end: {
      index: number;
      href: string;
    };
  }

  export interface Rendition {
    display(target?: string): Promise<void>;
    prev(): Promise<void>;
    next(): Promise<void>;
    themes: {
      fontSize(size: string): void;
      font(font: string): void;
    };
    on(event: string, callback: (data: any) => void): void;
    off(event: string, callback?: (data: any) => void): void;
  }

  export interface Book {
    ready: Promise<void>;
    loaded: {
      metadata: Promise<PackagingMetadata>;
      navigation: Promise<{ toc: NavItem[] }>;
    };
    spine: {
      items: Array<{ href: string }>;
    };
    renderTo(
      element: HTMLElement,
      options?: {
        width?: string | number;
        height?: string | number;
        spread?: string;
        flow?: string;
      }
    ): Rendition;
    coverUrl(): Promise<string | null>;
    load(href: string): Promise<Document | object>;
    destroy(): void;
  }

  function ePub(data: ArrayBuffer | string): Book;
  export default ePub;
}
