import React, { useEffect, useState, useRef } from 'react';
import { useGenAIStore } from '../../store/useGenAIStore';
import { useShallow } from 'zustand/react/shallow';
import { X, Copy, ChevronRight, ChevronDown, RotateCcw, Loader2 } from 'lucide-react';
import { TYPE_COLORS } from '../../types/content-analysis';
import type { ContentType } from '../../types/content-analysis';
import type { Rendition } from 'epubjs';
import { useToastStore } from '../../store/useToastStore';
import { dbService } from '../../db/DBService';
import type { TableImage } from '../../types/db';
import { useReaderStore } from '../../store/useReaderStore';
import { reprocessBook } from '../../lib/ingestion';

interface ContentAnalysisLegendProps {
  rendition?: Rendition | null;
}

export const ContentAnalysisLegend: React.FC<ContentAnalysisLegendProps> = ({ rendition }) => {
  const { isDebugModeEnabled, setDebugModeEnabled } = useGenAIStore(
    useShallow((state) => ({
      isDebugModeEnabled: state.isDebugModeEnabled,
      setDebugModeEnabled: state.setDebugModeEnabled,
    }))
  );

  const [cfiInput, setCfiInput] = useState('');
  const [mergedContent, setMergedContent] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  const showToast = useToastStore(state => state.showToast);
  const [isReprocessing, setIsReprocessing] = useState(false);

  // Table Images Carousel State
  const [tableImages, setTableImages] = useState<TableImage[]>([]);

  // Use a ref to track generated URLs so we can clean them up without state updates on unmount
  const generatedUrls = useRef<Record<string, string>>({});
  // State for rendering
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const currentBookId = useReaderStore(state => state.currentBookId);

  // Helper to clear URLs
  const clearUrls = () => {
      Object.values(generatedUrls.current).forEach(url => URL.revokeObjectURL(url));
      generatedUrls.current = {};
  };

  // Load Table Images and Manage Blob URLs
  useEffect(() => {
      if (!isDebugModeEnabled || !currentBookId) {
          // Clean up when disabled or switching books
          // We can't clear state synchronously if this effect was triggered by render,
          // but we can ensure we don't leak URLs.
          // Since the component returns null when !isDebugModeEnabled, the UI is hidden anyway.
          // But to be safe and avoid stale state if re-enabled:
          clearUrls();
          return;
      }

      let isMounted = true;

      const loadTables = async () => {
          // Clear previous URLs before loading new ones to avoid leaks during rapid switching
          clearUrls();
          // We can't easily reset tableImages here without causing a flash or extra render,
          // but since we just cleared URLs, the old images won't render anyway (or will break).
          // Ideally we would setTableImages([]) but we want to avoid the lint error.
          // Let's rely on the fact that we replace the state below.

          try {
              const images = await dbService.getTableImages(currentBookId);
              if (isMounted && images) {
                  setTableImages(images);

                  // Generate new
                  const newUrls: Record<string, string> = {};
                  images.forEach(img => {
                      const url = URL.createObjectURL(img.imageBlob);
                      newUrls[img.id] = url;
                      generatedUrls.current[img.id] = url;
                  });

                  setImageUrls(newUrls);
              }
          } catch (e) {
              console.error("Failed to load table images for debug", e);
          }
      };
      loadTables();

      return () => {
          isMounted = false;
          // We don't clear URLs on unmount of the effect immediately if we want to keep them while mounted.
          // But if bookId changes, we DO want to clear.
          // The cleanup function runs before the next effect run.
          // So if bookId changes, this runs, then the new effect run calls loadTables which calls clearUrls again.
          // Duplicate clear is fine.
      };
  }, [isDebugModeEnabled, currentBookId]);

  // Cleanup URLs on final unmount
  useEffect(() => {
      return () => {
          clearUrls();
      };
  }, []);


  // Listen for selection changes in the reader
  useEffect(() => {
    if (!rendition || !isDebugModeEnabled) return;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const handleSelected = (cfiRange: string, _contents: unknown) => {
        setCfiInput(cfiRange);

        // Get text content
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const range = (rendition as any).getRange(cfiRange);
            if (range) {
                setMergedContent(range.toString());
            }
        } catch (e) {
            console.warn("Failed to get range for CFI", e);
        }
    };

    rendition.on('selected', handleSelected);

    return () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rendition as any).off('selected', handleSelected);
    };
  }, [rendition, isDebugModeEnabled]);

  const handleCfiChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const newCfi = e.target.value;
      setCfiInput(newCfi);

      if (!rendition || !newCfi) return;

      try {
          // Display the location
          await rendition.display(newCfi);

          // Try to select it visually
          // getting range from cfi
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const range = (rendition as any).getRange(newCfi);
          if (range) {
              setMergedContent(range.toString());

              // We need to find which contents object this range belongs to
              // rendition.getContents() returns an array of contents
              // We can try to select in all of them or find the right one.
              // A simpler way for debug is just to rely on rendition.display to show it,
              // and maybe add a temporary annotation.

              // Select in DOM
              // This is the main window selection, but reader is in iframe

              // We need to access the iframe's selection
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const contents = (rendition as any).getContents();
              if (contents && contents.length > 0) {
                  // Iterate through contents to find where the range belongs (or just try all)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  contents.forEach((content: any) => {
                       const contentDoc = content.document;
                       const contentWin = content.window;
                       if (contentDoc && contentWin) {
                           // This part is tricky because 'range' object from getRange might be created in the context of the iframe
                           // provided by epub.js

                           // Actually, rendition.getRange(cfi) returns a Range object valid in the document context.
                           // Let's try to add it to selection.
                           try {
                               const sel = contentWin.getSelection();
                               sel.removeAllRanges();
                               sel.addRange(range);
                           } catch {
                               // Ignore mismatch errors
                           }
                       }
                  });
              }
          }
      } catch (error) {
          // Invalid CFI or other error
          console.warn("Invalid CFI entered", error);
      }
  };

  const copyContent = () => {
      if (!mergedContent) return;
      navigator.clipboard.writeText(mergedContent).then(() => {
          showToast('Content copied to clipboard', 'success');
      });
  };

  const copyCfi = () => {
      if (!cfiInput) return;
      navigator.clipboard.writeText(cfiInput).then(() => {
          showToast('CFI copied to clipboard', 'success');
      });
  };

  const jumpToTable = (cfi: string) => {
      rendition?.display(cfi);
      setCfiInput(cfi);
  };

  const handleReprocess = async () => {
      if (!currentBookId) return;
      if (!window.confirm("Reprocess this book? This will re-extract all text and images. The page will reload.")) {
          return;
      }

      setIsReprocessing(true);
      try {
          await reprocessBook(currentBookId);
          window.location.reload();
      } catch (e) {
          console.error("Reprocessing failed", e);
          showToast("Reprocessing failed", 'error');
          setIsReprocessing(false);
      }
  };

  if (!isDebugModeEnabled) return null;

  return (
    <div className="fixed bottom-20 left-4 z-50 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-3 text-xs w-72 max-h-[80vh] overflow-y-auto flex flex-col gap-3 transition-all duration-300">
      <div className="flex items-center justify-between border-b pb-2">
        <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 font-semibold hover:text-primary"
        >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Debug Panel
        </button>
        <button
          onClick={() => setDebugModeEnabled(false)}
          className="hover:bg-muted rounded p-0.5"
          aria-label="Close debug legend"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {isExpanded && (
          <div className="space-y-4">
            {/* Reprocess Action */}
            <div className="flex items-center justify-between bg-muted/50 p-2 rounded">
                <span className="font-semibold text-muted-foreground">Actions</span>
                <button
                    onClick={handleReprocess}
                    disabled={isReprocessing}
                    className="flex items-center gap-1 px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 text-[10px]"
                >
                    {isReprocessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                    Reprocess Book
                </button>
            </div>

            {/* CFI Debugger */}
            <div className="space-y-2">
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase text-muted-foreground font-bold">Current CFI</label>
                    <div className="flex gap-1">
                        <input
                            type="text"
                            value={cfiInput}
                            onChange={handleCfiChange}
                            placeholder="epubcfi(...)"
                            className="flex-1 bg-muted p-1 rounded border border-input text-[10px] font-mono"
                        />
                        <button onClick={copyCfi} className="p-1 hover:bg-accent rounded" title="Copy CFI">
                            <Copy className="h-3 w-3" />
                        </button>
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase text-muted-foreground font-bold">Selected Text</label>
                     <div className="relative">
                        <textarea
                            readOnly
                            value={mergedContent}
                            className="w-full h-20 bg-muted p-1 rounded border border-input text-[10px] resize-none"
                        />
                        <button
                            onClick={copyContent}
                            className="absolute top-1 right-1 p-1 bg-background/80 hover:bg-accent rounded shadow-sm"
                            title="Copy Content"
                        >
                            <Copy className="h-3 w-3" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Table Images Carousel */}
            {tableImages.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t">
                    <div className="text-[10px] uppercase text-muted-foreground font-bold mb-1">
                        Table Images ({tableImages.length})
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-2 snap-x">
                        {tableImages.map((img) => imageUrls[img.id] ? (
                            <div key={img.id} className="snap-start shrink-0 w-24 flex flex-col gap-1">
                                <div className="aspect-video bg-muted rounded overflow-hidden relative group">
                                    <img
                                        src={imageUrls[img.id]}
                                        alt="Table snapshot"
                                        className="w-full h-full object-cover"
                                    />
                                    <button
                                        onClick={() => jumpToTable(img.cfi)}
                                        className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white font-bold transition-opacity"
                                    >
                                        JUMP
                                    </button>
                                </div>
                                <div className="text-[9px] font-mono truncate text-muted-foreground" title={img.cfi}>
                                    {img.cfi}
                                </div>
                                <div className="text-[9px] text-muted-foreground">
                                    {(img.imageBlob.size / 1024).toFixed(1)} KB
                                </div>
                            </div>
                        ) : null)}
                    </div>
                </div>
            )}

            {/* Legend */}
            <div className="space-y-1.5 pt-2 border-t">
                <div className="text-[10px] uppercase text-muted-foreground font-bold mb-1">Content Types</div>
                {(Object.entries(TYPE_COLORS) as [ContentType, string][]).map(([type, color]) => (
                <div key={type} className="flex items-center gap-2">
                    <div
                    className="w-3 h-3 rounded-sm border border-foreground/20"
                    style={{ backgroundColor: color }}
                    />
                    <span className="capitalize">{type}</span>
                </div>
                ))}
            </div>
          </div>
      )}
    </div>
  );
};
