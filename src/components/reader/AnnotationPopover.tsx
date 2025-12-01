import React from 'react';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { Copy, StickyNote, X, Mic, Highlighter } from 'lucide-react';

interface Props {
  bookId: string;
  onClose: () => void;
  onFixPronunciation?: (text: string) => void;
}

export const AnnotationPopover: React.FC<Props> = ({ bookId, onClose, onFixPronunciation }) => {
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

  const handleHighlight = async () => {
    await addAnnotation({
      bookId,
      cfiRange: popover.cfiRange,
      text: popover.text,
      type: 'highlight',
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
                  data-testid="popover-note-input"
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
              <button data-testid="popover-save-note-button" onClick={handleSaveNote} className="p-1 hover:bg-green-100 dark:hover:bg-green-900 rounded text-green-600" aria-label="Save Note">
                  <StickyNote className="w-4 h-4" />
              </button>
              <button data-testid="popover-cancel-note-button" onClick={() => setIsEditingNote(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300" aria-label="Cancel Note">
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
      <button
        data-testid="popover-highlight-button"
        className="p-1 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 rounded text-yellow-600 dark:text-yellow-400"
        onClick={handleHighlight}
        title="Highlight"
      >
        <Highlighter className="w-4 h-4" />
      </button>

      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

      <button data-testid="popover-add-note-button" onClick={handleNoteClick} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300" title="Add Note">
        <StickyNote className="w-4 h-4" />
      </button>

      {onFixPronunciation && (
          <button data-testid="popover-fix-pronunciation-button" onClick={() => { onFixPronunciation(popover.text); hidePopover(); onClose(); }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300" title="Fix Pronunciation">
            <Mic className="w-4 h-4" />
          </button>
      )}
      <button data-testid="popover-copy-button" onClick={handleCopy} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300" title="Copy">
        <Copy className="w-4 h-4" />
      </button>
      <button data-testid="popover-close-button" onClick={hidePopover} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300" title="Close">
         <X className="w-4 h-4" />
      </button>
    </div>
  );
};
