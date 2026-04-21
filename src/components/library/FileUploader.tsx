import React, { useCallback, useState } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { UploadCloud } from 'lucide-react';
import { cn } from '../../lib/utils';
import { validateZipSignature } from '../../lib/ingestion';
import { DuplicateBookError } from '../../types/errors';
import { ImportProgressUI } from './ImportProgressUI';
import { useShallow } from 'zustand/react/shallow';
import { Loader2 } from 'lucide-react';
import { ReplaceBookDialog } from './ReplaceBookDialog';
import { useGoogleServicesStore } from '../../store/useGoogleServicesStore';
import { googleIntegrationManager } from '../../lib/google/GoogleIntegrationManager';
import { Button } from '../ui/Button';
import { DriveImportDialog } from '../drive/DriveImportDialog';
import { createLogger } from '../../lib/logger';

const logger = createLogger('FileUploader');

/**
 * A component for uploading EPUB files, ZIP archives, or directories via drag-and-drop or file selection.
 * Handles user interactions and triggers the book import process.
 *
 * @returns A React component rendering the file upload area.
 */
export const FileUploader: React.FC = () => {
  const {
    addBook,
    addBooks,
    isImporting
  } = useLibraryStore(useShallow(state => ({
    addBook: state.addBook,
    addBooks: state.addBooks,
    isImporting: state.isImporting
  })));

  const { showToast } = useToastStore();
  const [dragActive, setDragActive] = useState(false);
  const [duplicateQueue, setDuplicateQueue] = useState<File[]>([]);
  const currentDuplicate = duplicateQueue[0];

  /**
   * Validates and processes a single file.
   */
  const processSingleFile = useCallback(async (file: File) => {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.epub')) {
      const isValid = await validateZipSignature(file);
      if (isValid) {
        try {
          await addBook(file);
        } catch (error) {
          if (error instanceof DuplicateBookError) {
            setDuplicateQueue(prev => [...prev, file]);
          }
        }
      } else {
        showToast(`Invalid EPUB file (header mismatch): ${file.name}`, 'error');
      }
    } else if (lowerName.endsWith('.zip')) {
      const isValid = await validateZipSignature(file);
      if (isValid) {
        await addBooks([file]);
      } else {
        showToast(`Invalid ZIP file (header mismatch): ${file.name}`, 'error');
      }
    } else {
      showToast(`Unsupported file type: ${file.name}`, 'error');
    }
  }, [addBook, addBooks, showToast]);

  /**
   * Processes a list of files (batch import).
   */
  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 1) {
      await processSingleFile(files[0]);
    } else {
      // Validate all files before passing to batch import
      const validFiles: File[] = [];
      for (const file of files) {
        const lowerName = file.name.toLowerCase();
        if (lowerName.endsWith('.epub') || lowerName.endsWith('.zip')) {
          const isValid = await validateZipSignature(file);
          if (isValid) {
            validFiles.push(file);
          } else {
            showToast(`Skipping invalid file: ${file.name}`, 'error');
          }
        } else {
          showToast(`Skipping unsupported file: ${file.name}`, 'error');
        }
      }

      if (validFiles.length > 0) {
        await addBooks(validFiles);
      }
    }
  }, [addBooks, processSingleFile, showToast]);

  /**
   * Handles drag events.
   */
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  /**
   * Handles drop events.
   */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        await processFiles(files);
      }
    },
    [processFiles]
  );

  /**
   * Handles standard file input change.
   */
  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      await processFiles(files);
    }
    // Reset input
    e.target.value = '';
  };

  const { isServiceConnected } = useGoogleServicesStore();
  const isDriveConnected = isServiceConnected('drive');
  const [isDriveConnecting, setIsDriveConnecting] = useState(false);

  const handleDriveConnect = async () => {
    setIsDriveConnecting(true);
    try {
      await googleIntegrationManager.connectService('drive');
    } catch (error) {
      logger.error("Failed to connect Drive", error);
      showToast("Failed to connect Google Drive", 'error');
    } finally {
      setIsDriveConnecting(false);
    }
  };

  const [isDriveImportOpen, setIsDriveImportOpen] = useState(false);

  const handleBrowseDrive = async () => {
    try {
      const token = await googleIntegrationManager.getValidToken('drive');
      logger.debug("Drive Token Valid, opening picker", token);
      setIsDriveImportOpen(true);
    } catch (error) {
      logger.error("Failed to access Drive", error);
      showToast("Failed to access Google Drive. Please reconnect.", 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Cloud Integration Header */}
      <div className="flex justify-end">
        {!isDriveConnected ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-primary"
            onClick={handleDriveConnect}
            disabled={isDriveConnecting}
            aria-label="Connect Google Drive"
          >
            {isDriveConnecting ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden="true" />
                <span className="sr-only">Connecting...</span>
              </>
            ) : null}
            Connect Google Drive
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-primary border-primary/20 hover:bg-primary/5"
            onClick={handleBrowseDrive}
            aria-label="Browse Google Drive"
          >
            <svg className="w-4 h-4" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
              <path d="m6.6 66.85 25.3-43.8 25.3 43.8z" fill="currentColor" />
              <path d="m43.85 66.85 25.3-43.8 18.15 31.45-8.35 14.35h-35.1z" fill="currentColor" fillOpacity="0.7" />
              <path d="m87.3 52.5-18.15-31.45-18.15-31.45h-36.3l18.15 31.45z" fill="currentColor" fillOpacity="0.5" />
            </svg>
            Browse Google Drive
          </Button>
        )}
      </div>

      <div
        className={cn(
          "group relative w-full border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200 ease-in-out cursor-pointer focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          dragActive
            ? "border-primary bg-accent"
            : "border-muted-foreground/25 hover:border-primary hover:bg-muted/30"
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          id="file-upload"
          data-testid="file-upload-input"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          onChange={handleChange}
          accept=".epub,.zip"
          multiple
          disabled={isImporting}
          aria-label="Upload EPUB or ZIP files"
        />

        {isImporting ? (
          <ImportProgressUI />
        ) : (
          <div className="flex flex-col items-center justify-center space-y-3 pointer-events-none">
            <div className={cn(
              "p-4 rounded-full bg-muted transition-all duration-200",
              dragActive ? "bg-background scale-110" : "group-hover:bg-background"
            )}>
              <UploadCloud className={cn("h-8 w-8 text-muted-foreground transition-colors", dragActive && "text-primary")} />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-medium text-foreground">
                {dragActive ? (
                  "Release to drop files here"
                ) : (
                  <>Drop EPUBs or ZIPs here, or <span className="text-primary hover:underline">browse</span></>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                Supports .epub and .zip archives
              </p>
            </div>
          </div>
        )}
      </div>

      <ReplaceBookDialog
        isOpen={!!currentDuplicate}
        onClose={() => setDuplicateQueue(prev => prev.slice(1))}
        onConfirm={async () => {
          if (!currentDuplicate) return;
          try {
            await addBook(currentDuplicate, { overwrite: true });
            showToast("Book replaced successfully", "success");
          } catch (error) {
            showToast(`Replace failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
            throw error;
          }
        }}
        fileName={currentDuplicate?.name || ''}
      />

      <DriveImportDialog
        isOpen={isDriveImportOpen}
        onClose={() => setIsDriveImportOpen(false)}
      />

    </div>
  );
};
