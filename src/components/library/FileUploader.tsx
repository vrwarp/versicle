import React, { useCallback, useState } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { UploadCloud, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { validateEpubFile } from '../../lib/ingestion';

/**
 * A component for uploading EPUB files via drag-and-drop or file selection.
 * Handles user interactions and triggers the book import process.
 *
 * @returns A React component rendering the file upload area.
 */
export const FileUploader: React.FC = () => {
  const { addBook, isImporting, importProgress, importStatus } = useLibraryStore();
  const { showToast } = useToastStore();
  const [dragActive, setDragActive] = useState(false);

  /**
   * Validates and processes the selected file.
   * Checks for .epub extension and validates ZIP magic bytes.
   */
  const processFile = useCallback(async (file: File) => {
      // Check extension first for quick feedback
      if (file.name.endsWith('.epub')) {
           // Security Check: Validate Magic Bytes
           const isValid = await validateEpubFile(file);
           if (isValid) {
               addBook(file);
           } else {
               showToast("Invalid EPUB file (header mismatch)", 'error');
           }
      } else {
           showToast("Only .epub files are supported", 'error');
      }
  }, [addBook, showToast]);

  /**
   * Handles drag events to toggle visual feedback for the drop zone.
   *
   * @param e - The React DragEvent.
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
   * Handles the drop event to process the dropped file.
   *
   * @param e - The React DragEvent containing the dropped files.
   */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        await processFile(e.dataTransfer.files[0]);
      }
    },
    [processFile]
  );

  /**
   * Handles the file input change event for browsing and selecting files.
   *
   * @param e - The React ChangeEvent from the file input.
   */
  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      await processFile(e.target.files[0]);
    }
  };

  return (
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
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        onChange={handleChange}
        accept=".epub"
        disabled={isImporting}
        aria-label="Upload EPUB file"
      />

      {isImporting ? (
        <div className="flex flex-col items-center justify-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground font-medium">{importStatus || 'Importing book...'}</p>
            <div className="w-64 h-2 bg-muted rounded-full overflow-hidden mt-2">
                <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${importProgress}%` }}
                />
            </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center space-y-3">
            <div className={cn(
                "p-4 rounded-full bg-muted transition-colors",
                dragActive ? "bg-background" : "group-hover:bg-background"
            )}>
                <UploadCloud className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
                <p className="text-lg font-medium text-foreground">
                    Drop your EPUB here, or <span className="text-primary hover:underline">browse</span>
                </p>
                <p className="text-sm text-muted-foreground">
                    Supports .epub files
                </p>
            </div>
        </div>
      )}
    </div>
  );
};
