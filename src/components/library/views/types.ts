import type { BookMetadata } from '../../../types/db';

export interface ViewProps {
  books: BookMetadata[];
  dimensions: { width: number; height: number };
}
