export type ContentType = 'title' | 'citation' | 'main' | 'table' | 'other';

export interface ContentTypeResult {
  rootCfi: string;
  type: ContentType;
}

export const TYPE_COLORS: Record<ContentType, string> = {
  main: 'rgba(0, 255, 0, 0.3)',      // Green
  title: 'rgba(0, 0, 255, 0.3)',     // Blue
  citation: 'rgba(255, 255, 0, 0.3)', // Yellow
  table: 'rgba(255, 0, 0, 0.3)',      // Red
  other: 'rgba(128, 128, 128, 0.3)',  // Gray
};
