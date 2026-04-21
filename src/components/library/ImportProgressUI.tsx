import React from 'react';
import { Loader2 } from 'lucide-react';
import { Progress } from '../ui/Progress';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useShallow } from 'zustand/react/shallow';

export const ImportProgressUI: React.FC = () => {
  const {
    isImporting,
    importProgress,
    importStatus,
    uploadProgress,
    uploadStatus
  } = useLibraryStore(useShallow(state => ({
    isImporting: state.isImporting,
    importProgress: state.importProgress,
    importStatus: state.importStatus,
    uploadProgress: state.uploadProgress,
    uploadStatus: state.uploadStatus
  })));

  if (!isImporting) return null;

  return (
    <div className="flex flex-col items-center justify-center space-y-3 mt-4 w-full p-4">
      <div role="status" aria-label="Loading">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">Processing files...</span>
      </div>

      {/* Upload/Processing Progress */}
      <div className="w-full flex flex-col items-center space-y-1">
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {uploadStatus || 'Processing files...'}
        </p>
        <Progress value={uploadProgress} className="w-full max-w-xs" aria-label="Upload progress" />
      </div>

      {/* Import Progress (only show if upload is done or if import started) */}
      {(importProgress > 0 || uploadProgress >= 100) && (
        <div className="w-full flex flex-col items-center space-y-1 mt-2">
          <p className="text-muted-foreground font-medium" role="status" aria-live="polite">
            {importStatus || 'Importing books...'}
          </p>
          <Progress value={importProgress} className="w-full max-w-xs" aria-label="Import progress" />
        </div>
      )}
    </div>
  );
};
