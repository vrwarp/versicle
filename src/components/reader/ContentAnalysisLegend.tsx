import { useGenAIStore } from '../../store/useGenAIStore';
import { useShallow } from 'zustand/react/shallow';
import { X } from 'lucide-react';
import { TYPE_COLORS } from '../../types/content-analysis';
import type { ContentType } from '../../types/content-analysis';

export const ContentAnalysisLegend = () => {
  const { isDebugModeEnabled, setDebugModeEnabled } = useGenAIStore(
    useShallow((state) => ({
      isDebugModeEnabled: state.isDebugModeEnabled,
      setDebugModeEnabled: state.setDebugModeEnabled,
    }))
  );

  if (!isDebugModeEnabled) return null;

  return (
    <div className="fixed bottom-20 left-4 z-50 bg-background/90 backdrop-blur-sm border rounded-lg shadow-lg p-3 text-xs w-48">
      <div className="flex items-center justify-between mb-2 pb-2 border-b">
        <span className="font-semibold">Content Types</span>
        <button
          onClick={() => setDebugModeEnabled(false)}
          className="hover:bg-muted rounded p-0.5"
          aria-label="Close debug legend"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-1.5">
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
  );
};
