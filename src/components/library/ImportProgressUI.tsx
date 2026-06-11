import React from 'react';
import { Loader2 } from 'lucide-react';
import { Progress } from '../ui/Progress';
import { Button } from '../ui/Button';
import { useLibraryStore } from '@store/useLibraryStore';
import { useShallow } from 'zustand/react/shallow';

export const ImportProgressUI: React.FC = () => {
  const {
    isImporting,
    importProgress,
    importStatus,
    uploadProgress,
    uploadStatus,
    batchImportSummary,
    clearBatchImportSummary
  } = useLibraryStore(useShallow(state => ({
    isImporting: state.isImporting,
    importProgress: state.importProgress,
    importStatus: state.importStatus,
    uploadProgress: state.uploadProgress,
    uploadStatus: state.uploadStatus,
    batchImportSummary: state.batchImportSummary,
    clearBatchImportSummary: state.clearBatchImportSummary
  })));

  if (!isImporting) {
    // After a batch import completes, surface the per-file outcome summary
    // (imported / skipped duplicates / failed with reasons) until dismissed.
    if (!batchImportSummary) return null;
    const { imported, skipped, failed } = batchImportSummary;

    return (
      <div
        className="mt-4 w-full p-4 rounded-lg border bg-muted/30 text-left space-y-2"
        data-testid="batch-import-summary"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-foreground" role="status" aria-live="polite">
            Import complete: {imported} imported, {skipped.length} duplicates skipped, {failed.length} failed
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearBatchImportSummary}
            aria-label="Dismiss import summary"
          >
            Dismiss
          </Button>
        </div>

        {skipped.length > 0 && (
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Skipped duplicates ({skipped.length})</summary>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              {skipped.map((filename, index) => (
                <li key={`${filename}-${index}`}>{filename}</li>
              ))}
            </ul>
          </details>
        )}

        {failed.length > 0 && (
          <details className="text-sm text-destructive" open>
            <summary className="cursor-pointer">Failed files ({failed.length})</summary>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              {failed.map(({ filename, reason }, index) => (
                <li key={`${filename}-${index}`}>
                  <span className="font-medium">{filename}</span>: {reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center space-y-3 mt-4 w-full p-4">
      <div role="status" aria-label="Loading">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only" aria-live="polite">Processing files...</span>
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
