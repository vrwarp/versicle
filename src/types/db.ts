export interface BookMetadata {
  id: string;
  title: string;
  author: string;
  description?: string;
  coverUrl?: string; // Blob URL (created on load, revoked on unload)
  addedAt: number;
  lastRead?: number;
  progress?: number; // 0-1 percentage
  currentCfi?: string; // Last read position
}

export interface Annotation {
  id: string;
  bookId: string;
  cfiRange: string;
  text: string; // The selected text
  color: string;
  note?: string;
  createdAt: number;
}
