import React, { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { computeDiff, type DiffNode } from '../../lib/json-diff';

interface JsonDiffViewerProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oldValue: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  newValue: any;
  className?: string;
}

const DiffNodeView: React.FC<{ node: DiffNode; level?: number }> = ({ node, level = 0 }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const indent = level * 16;
  const hasChildren = node.children && node.children.length > 0;

  if (node.type === 'unchanged') {
      return (
        <div style={{ marginLeft: indent }} className="text-muted-foreground font-mono text-xs whitespace-pre-wrap opacity-60">
           {node.key}: {typeof node.value === 'object' ? '...' : String(node.value)}
        </div>
      );
  }

  if (node.type === 'added') {
    return (
      <div style={{ marginLeft: indent }} className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 font-mono text-xs whitespace-pre-wrap p-1 rounded my-0.5 break-all">
        + {node.key}: {typeof node.value === 'object' ? JSON.stringify(node.value) : String(node.value)}
      </div>
    );
  }

  if (node.type === 'removed') {
    return (
      <div style={{ marginLeft: indent }} className="bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 font-mono text-xs whitespace-pre-wrap p-1 rounded my-0.5 break-all">
        - {node.key}: {typeof node.value === 'object' ? JSON.stringify(node.value) : String(node.value)}
      </div>
    );
  }

  // Modified
  if (hasChildren) {
    return (
      <div className="my-0.5">
        <div
            className="flex items-center cursor-pointer hover:bg-muted/50 rounded p-1 select-none"
            style={{ marginLeft: indent }}
            onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
          <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{node.key}</span>
        </div>
        {isExpanded && (
            <div>
                {node.children!.map((child, i) => (
                    <DiffNodeView key={i} node={child} level={level + 1} />
                ))}
            </div>
        )}
      </div>
    );
  }

  // Primitive modification (leaf node)
  return (
    <div style={{ marginLeft: indent }} className="font-mono text-xs p-1 my-0.5">
       <span className="font-bold">{node.key}:</span>
       <div className="grid grid-cols-2 gap-2 mt-1">
          <div className="bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 p-1 rounded break-all">
            - {JSON.stringify(node.oldValue)}
          </div>
          <div className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 p-1 rounded break-all">
            + {JSON.stringify(node.newValue)}
          </div>
       </div>
    </div>
  );
};

export const JsonDiffViewer: React.FC<JsonDiffViewerProps> = ({ oldValue, newValue, className }) => {
  const diffTree = useMemo(() => computeDiff(oldValue, newValue, 'root'), [oldValue, newValue]);

  return (
    <div className={cn("overflow-auto max-h-[60vh] p-2 bg-background border rounded-md", className)}>
        {diffTree.children ? (
            diffTree.children.map((child, i) => <DiffNodeView key={i} node={child} />)
        ) : (
            <DiffNodeView node={diffTree} />
        )}
    </div>
  );
};
