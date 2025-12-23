import React, { useCallback, useState } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { UploadCloud, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { validateZipSignature } from '../../lib/ingestion';

/**
 * A component for uploading EPUB files, ZIP archives, or directories via drag-and-drop or file selection.
 * Handles user interactions and triggers the book import process.
 *
 * @returns A React component rendering the file upload area.
 */
export const FileUploader: React.FC = () => {
  const { addBook, addBooks, isImporting, importProgress, importStatus } = useLibraryStore();
  const { showToast } = useToastStore();
  const [dragActive, setDragActive] = useState(false);
  /**
   * Validates and processes a single file.
   */
  const processSingleFile = useCallback(async (file: File) => {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.epub')) {
           const isValid = await validateZipSignature(file);
           if (isValid) {
               await addBook(file);
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

  return (
    <div className="space-y-4">
    <div
      className={cn(
        "group relative w-full border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200 ease-in-out cursor-pointer",
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
        <div className="flex flex-col items-center justify-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground font-medium">{importStatus || 'Importing books...'}</p>
            <div className="w-64 h-2 bg-muted rounded-full overflow-hidden mt-2">
                <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${importProgress}%` }}
                />
            </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center space-y-3 pointer-events-none">
            <div className={cn(
                "p-4 rounded-full bg-muted transition-colors",
                dragActive ? "bg-background" : "group-hover:bg-background"
            )}>
                <UploadCloud className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
                <p className="text-lg font-medium text-foreground">
                    Drop EPUBs or ZIPs here, or <span className="text-primary hover:underline">browse</span>
                </p>
                <p className="text-sm text-muted-foreground">
                    Supports .epub and .zip archives
                </p>
            </div>
        </div>
      )}
    </div>

    </div>
  );
};
