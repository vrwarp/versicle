export type ContentType = 'title' | 'citation' | 'main' | 'table';

export interface ContentTypeResult {
  rootCfi: string;
  type: ContentType;
}
