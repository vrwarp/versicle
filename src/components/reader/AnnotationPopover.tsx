import React from 'react';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { Copy, StickyNote, X, Highlighter, PenLine } from 'lucide-react';

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

  const style: React.CSSProperties = {
    position: 'absolute',
    left: popover.x,
    top: popover.y - 60, // Display a bit higher
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
    onClose();
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
          <div className="bg-white dark:bg-gray-800 shadow-xl rounded-lg p-3 flex gap-2 items-center border border-gray-200 dark:border-gray-700" style={style}>
              <input
                  data-testid="popover-note-input"
                  type="text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Enter note..."
                  className="text-sm p-2 border rounded dark:bg-gray-700 dark:text-white dark:border-gray-600 focus:outline-none focus:border-blue-500 w-48"
                  autoFocus
                  onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveNote();
                      if (e.key === 'Escape') setIsEditingNote(false);
                  }}
              />
              <button data-testid="popover-save-note-button" onClick={handleSaveNote} className="p-2 hover:bg-green-100 dark:hover:bg-green-900 rounded text-green-600" aria-label="Save Note">
                  <StickyNote className="w-5 h-5" />
              </button>
              <button data-testid="popover-cancel-note-button" onClick={() => setIsEditingNote(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300" aria-label="Cancel Note">
                  <X className="w-5 h-5" />
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
    <div className="bg-white dark:bg-gray-800 shadow-xl rounded-lg p-3 flex gap-3 items-center border border-gray-200 dark:border-gray-700" style={style}>

      {/* Highlight Section */}
      <div className="flex items-center gap-2">
          <Highlighter className="w-4 h-4 text-gray-400 mr-1" />
          {COLORS.map((c) => (
            <button
              key={c.name}
              data-testid={`popover-color-${c.name.toLowerCase()}`}
              className="w-8 h-8 rounded-full border border-gray-300 hover:scale-110 transition-transform focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500"
              style={{ backgroundColor: c.value, opacity: 0.8 }}
              onClick={() => handleColorClick(c.name.toLowerCase())}
              title={`Highlight ${c.name}`}
              aria-label={`Highlight ${c.name}`}
            />
          ))}
      </div>

      <div className="w-px h-8 bg-gray-300 dark:bg-gray-600" />

      {/* Actions Section */}
      <div className="flex items-center gap-1">
        <button
            data-testid="popover-add-note-button"
            onClick={handleNoteClick}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300"
            title="Add Note"
            aria-label="Add Note"
        >
            <PenLine className="w-5 h-5" />
        </button>
        <button
            data-testid="popover-copy-button"
            onClick={handleCopy}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300"
            title="Copy Text"
            aria-label="Copy Text"
        >
            <Copy className="w-5 h-5" />
        </button>
      </div>

      <div className="w-px h-8 bg-gray-300 dark:bg-gray-600" />

      <button
        data-testid="popover-close-button"
        onClick={hidePopover}
        className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500"
        title="Close"
        aria-label="Close"
      >
         <X className="w-5 h-5" />
      </button>
    </div>
  );
};
