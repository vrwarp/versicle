import React from 'react';
import { useReaderStore } from '../../store/useReaderStore';
import { useReaderContext } from './ReaderContext';

export const TOC: React.FC = () => {
  const { toc } = useReaderStore();
  const { rendition } = useReaderContext();
  const [isOpen, setIsOpen] = React.useState(false);

  const handleChapterClick = (href: string) => {
    if (rendition) {
      rendition.display(href);
      setIsOpen(false);
    }
  };

  if (!toc || toc.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
      >
        TOC
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-white border shadow-lg max-h-96 overflow-y-auto z-20 rounded">
          <ul className="p-2">
            {toc.map((item) => (
              <li key={item.id} className="mb-1">
                <button
                  onClick={() => handleChapterClick(item.href)}
                  className="block w-full text-left px-2 py-1 hover:bg-gray-100 text-sm truncate"
                  title={item.label}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
