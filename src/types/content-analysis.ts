export type ContentType = 'reference';
export type AnalysisStatus = 'idle' | 'loading' | 'success' | 'error';

export const TYPE_COLORS: Record<ContentType, string> = {
  reference: 'rgba(255, 165, 0, 0.3)', // Orange
};
