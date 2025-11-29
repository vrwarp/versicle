import React, { useEffect, useRef } from 'react';
import { useReaderStore } from '../../store/useReaderStore';

interface TableOfContentsProps {
  onNavigate: (href: string) => void;
  onClose: () => void;
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({ onNavigate, onClose }) => {
  const { toc, currentChapterTitle } = useReaderStore();
  const activeItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Scroll active item into view when component mounts or active chapter changes
    if (activeItemRef.current) {
        activeItemRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [currentChapterTitle]);

  return (
    <div data-testid="reader-toc-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-20 absolute inset-y-0 left-0 md:static flex flex-col h-full bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700">
         <div className="p-4 border-b border-gray-100 dark:border-gray-700">
             <h2 className="text-lg font-bold text-foreground dark:text-white">Contents</h2>
         </div>
         <div className="flex-1 overflow-y-auto p-4">
             <ul className="space-y-2">
                 {toc.map((item, index) => {
                     const isActive = currentChapterTitle === item.label;
                     return (
                        <li key={item.id}>
                            <button
                                ref={isActive ? activeItemRef : null}
                                data-testid={`toc-item-${index}`}
                                className={`text-left w-full text-sm py-1 px-2 rounded transition-colors ${
                                    isActive
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium'
                                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                                }`}
                                onClick={() => {
                                    onNavigate(item.href);
                                    onClose();
                                }}
                            >
                                {item.label}
                            </button>
                        </li>
                     );
                 })}
             </ul>
         </div>
    </div>
  );
};
