import React from 'react';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { Copy, StickyNote, X } from 'lucide-react';

const COLORS = [
  { name: 'Yellow', value: '#ffff00', class: 'highlight-yellow' },
  { name: 'Green', value: '#00ff00', class: 'highlight-green' },
  { name: 'Blue', value: '#0000ff', class: 'highlight-blue' },
  { name: 'Red', value: '#ff0000', class: 'highlight-red' },
];

interface Props {
  bookId: string;
  onClose: () => void;
}

export const AnnotationPopover: React.FC<Props> = ({ bookId, onClose }) => {
  const { popover, addAnnotation, hidePopover } = useAnnotationStore();
  const [isEditingNote, setIsEditingNote] = React.useState(false);
  const [noteText, setNoteText] = React.useState('');

  if (!popover.visible) return null;

  // Calculate position to keep it within viewport (simplified)
  // We might need useLayoutEffect to measure dimensions
  const style: React.CSSProperties = {
    position: 'absolute',
    left: popover.x,
    top: popover.y - 50, // Display above selection
    zIndex: 50,
  };

  const handleColorClick = async (color: string) => {
    await addAnnotation({
      bookId,
      cfiRange: popover.cfiRange,
      text: popover.text,
      type: 'highlight',
      color,
    });
    hidePopover();
    onClose(); // Triggers parent to clear selection
  };

  const handleNoteClick = () => {
    setIsEditingNote(true);
  };

  const handleSaveNote = () => {
    if (noteText.trim()) {
        addAnnotation({
            bookId,
            cfiRange: popover.cfiRange,
            text: popover.text,
            type: 'note',
            color: 'yellow',
            note: noteText
        });
        hidePopover();
        onClose();
    }
  };

  if (isEditingNote) {
      return (
          <div className="bg-white dark:bg-gray-800 shadow-xl rounded-lg p-2 flex gap-2 items-center border border-gray-200 dark:border-gray-700" style={style}>
              <input
                  type="text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Enter note..."
                  className="text-xs p-1 border rounded dark:bg-gray-700 dark:text-white dark:border-gray-600 focus:outline-none focus:border-blue-500"
                  autoFocus
                  onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveNote();
                      if (e.key === 'Escape') setIsEditingNote(false);
                  }}
              />
              <button onClick={handleSaveNote} className="p-1 hover:bg-green-100 dark:hover:bg-green-900 rounded text-green-600" aria-label="Save Note">
                  <StickyNote className="w-4 h-4" />
              </button>
              <button onClick={() => setIsEditingNote(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300" aria-label="Cancel Note">
                  <X className="w-4 h-4" />
              </button>
          </div>
      );
  }

  const handleCopy = () => {
      navigator.clipboard.writeText(popover.text);
      hidePopover();
      onClose();
  };

  return (
    <div className="bg-white dark:bg-gray-800 shadow-xl rounded-lg p-2 flex gap-2 items-center border border-gray-200 dark:border-gray-700" style={style}>
      {COLORS.map((c) => (
        <button
          key={c.name}
          className="w-6 h-6 rounded-full border border-gray-300 hover:scale-110 transition-transform"
          style={{ backgroundColor: c.value, opacity: 0.7 }}
          onClick={() => handleColorClick(c.name.toLowerCase())}
          title={c.name}
        />
      ))}
      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
      <button onClick={handleNoteClick} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300" title="Add Note">
        <StickyNote className="w-4 h-4" />
      </button>
      <button onClick={handleCopy} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300" title="Copy">
        <Copy className="w-4 h-4" />
      </button>
      <button onClick={hidePopover} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300" title="Close">
         <X className="w-4 h-4" />
      </button>
    </div>
  );
};
