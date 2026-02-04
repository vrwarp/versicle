import React, { useState } from 'react';
import type { DiffResult } from '../../lib/sync/CheckpointInspector';
import { ChevronDown, ChevronRight, Plus, Minus, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';

interface CheckpointDiffViewProps {
  diffData: Record<string, DiffResult>;
  onConfirm: () => void;
  onCancel: () => void;
  isRestoring: boolean;
}

export const CheckpointDiffView: React.FC<CheckpointDiffViewProps> = ({
  diffData,
  onConfirm,
  onCancel,
  isRestoring
}) => {
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set());

  const toggleStore = (store: string) => {
    const newExpanded = new Set(expandedStores);
    if (newExpanded.has(store)) {
      newExpanded.delete(store);
    } else {
      newExpanded.add(store);
    }
    setExpandedStores(newExpanded);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderDiffSection = (title: string, data: Record<string, any>, colorClass: string, icon: React.ReactNode) => {
    if (Object.keys(data).length === 0) return null;
    return (
      <div className={`mt-2 p-2 rounded border ${colorClass} bg-opacity-10 text-xs`}>
        <div className="flex items-center gap-2 font-medium mb-1">
          {icon} {title} ({Object.keys(data).length})
        </div>
        <div className="pl-6 space-y-1">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="truncate">
              <span className="font-mono opacity-70">{key}:</span> {typeof value === 'object' ? JSON.stringify(value).substring(0, 50) + '...' : String(value)}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderModifiedSection = (data: Record<string, { old: any; new: any }>) => {
    if (Object.keys(data).length === 0) return null;
    return (
      <div className="mt-2 p-2 rounded border border-blue-200 bg-blue-50 text-xs dark:bg-blue-900/20 dark:border-blue-800">
        <div className="flex items-center gap-2 font-medium mb-1 text-blue-700 dark:text-blue-300">
          <RefreshCw className="w-3 h-3" /> Modified ({Object.keys(data).length})
        </div>
        <div className="pl-6 space-y-2">
          {Object.entries(data).map(([key, value]) => (
            <div key={key}>
              <div className="font-mono opacity-70 mb-0.5">{key}:</div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="bg-red-100 dark:bg-red-900/30 p-1 rounded text-red-800 dark:text-red-300 truncate">
                  - {JSON.stringify(value.old)}
                </div>
                <div className="bg-green-100 dark:bg-green-900/30 p-1 rounded text-green-800 dark:text-green-300 truncate">
                  + {JSON.stringify(value.new)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full max-h-[60vh]">
      <div className="p-4 border-b">
        <h3 className="text-lg font-semibold">Checkpoint Inspection</h3>
        <p className="text-sm text-muted-foreground">
          Review changes before restoring. This action will overwrite your current library.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Object.entries(diffData).map(([storeName, result]) => {
          const hasChanges = Object.keys(result.added).length > 0 ||
                             Object.keys(result.removed).length > 0 ||
                             Object.keys(result.modified).length > 0;

          if (!hasChanges) {
             return (
               <div key={storeName} className="p-2 border rounded bg-muted/20 opacity-60">
                 <div className="flex items-center justify-between">
                   <span className="font-medium capitalize">{storeName}</span>
                   <span className="text-xs text-muted-foreground">No changes</span>
                 </div>
               </div>
             );
          }

          const isExpanded = expandedStores.has(storeName);

          return (
            <div key={storeName} className="border rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors"
                onClick={() => toggleStore(storeName)}
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="font-medium capitalize">{storeName}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                   {Object.keys(result.added).length > 0 && <span className="text-green-600 font-bold">+{Object.keys(result.added).length}</span>}
                   {Object.keys(result.removed).length > 0 && <span className="text-red-600 font-bold">-{Object.keys(result.removed).length}</span>}
                   {Object.keys(result.modified).length > 0 && <span className="text-blue-600 font-bold">~{Object.keys(result.modified).length}</span>}
                </div>
              </button>

              {isExpanded && (
                <div className="p-3 border-t space-y-2">
                  {renderDiffSection('To Be Recovered (Added)', result.added, 'border-green-200 bg-green-50 text-green-900 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300', <Plus className="w-3 h-3" />)}
                  {renderDiffSection('To Be Lost (Removed)', result.removed, 'border-red-200 bg-red-50 text-red-900 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300', <Minus className="w-3 h-3" />)}
                  {renderModifiedSection(result.modified)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-4 border-t bg-muted/10 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={isRestoring}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={isRestoring}>
          {isRestoring ? 'Restoring...' : 'Confirm Restore'}
        </Button>
      </div>
    </div>
  );
};
