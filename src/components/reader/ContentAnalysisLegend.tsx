import React, { useEffect, useState } from 'react';
import { useGenAIStore } from '../../store/useGenAIStore';
import { useShallow } from 'zustand/react/shallow';
import { X, Copy, ChevronRight, ChevronDown } from 'lucide-react';
import { TYPE_COLORS } from '../../types/content-analysis';
import type { ContentType } from '../../types/content-analysis';
import type { Rendition } from 'epubjs';
import { useToastStore } from '../../store/useToastStore';

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

  if (!isDebugModeEnabled) return null;

  return (
    <div className="fixed bottom-20 left-4 z-50 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-3 text-xs w-64 max-h-[80vh] overflow-y-auto flex flex-col gap-3 transition-all duration-300">
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
