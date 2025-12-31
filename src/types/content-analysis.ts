export type ContentType = 'title' | 'citation' | 'main' | 'table' | 'other';

export interface ContentTypeResult {
  rootCfi: string;
  type: ContentType;
}
