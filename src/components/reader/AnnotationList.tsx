import React from 'react';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { Trash2, StickyNote, PenLine } from 'lucide-react';
import type { Annotation } from '../../types/db';

interface Props {
  /** Callback to navigate to the annotation's location. */
  onNavigate: (cfi: string) => void;
}

/**
 * Component to display a list of annotations (highlights and notes).
 * Allows editing notes and deleting annotations.
 *
 * @param props - Component props.
 * @returns A React component rendering the annotation list.
 */
export const AnnotationList: React.FC<Props> = ({ onNavigate }) => {
  const { annotations, deleteAnnotation, updateAnnotation } = useAnnotationStore();

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this annotation?')) {
      deleteAnnotation(id);
    }
  };

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editNoteText, setEditNoteText] = React.useState('');

  const handleEditNote = (e: React.MouseEvent, annotation: Annotation) => {
      e.stopPropagation();
      setEditingId(annotation.id);
      setEditNoteText(annotation.note || '');
  };

  const saveEdit = (id: string) => {
      updateAnnotation(id, { note: editNoteText });
      setEditingId(null);
  };

  if (annotations.length === 0) {
    return <div className="p-4 text-sm text-gray-500 text-center">No annotations yet. Select text to highlight.</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {annotations.map((annotation) => (
          <li key={annotation.id} data-testid={`annotation-item-${annotation.id}`} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer group" onClick={() => onNavigate(annotation.cfiRange)}>
            <div className="flex justify-between items-start gap-2">
              <div className="flex-1 min-w-0">
                  {editingId === annotation.id ? (
                      <div className="mb-2" onClick={(e) => e.stopPropagation()}>
                          <input
                             data-testid="annotation-note-input"
                             type="text"
                             value={editNoteText}
                             onChange={(e) => setEditNoteText(e.target.value)}
                             className="w-full text-xs p-1 border rounded dark:bg-gray-700 dark:text-white dark:border-gray-600 mb-1"
                             autoFocus
                             onKeyDown={(e) => {
                                 if (e.key === 'Enter') saveEdit(annotation.id);
                                 if (e.key === 'Escape') setEditingId(null);
                             }}
                          />
                          <div className="flex gap-1">
                              <button data-testid="annotation-save-button" onClick={() => saveEdit(annotation.id)} className="text-xs bg-blue-500 text-white px-2 py-1 rounded">Save</button>
                              <button data-testid="annotation-cancel-button" onClick={() => setEditingId(null)} className="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">Cancel</button>
                          </div>
                      </div>
                  ) : (
                      <>
                        {annotation.note && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                                <StickyNote className="w-3 h-3" />
                                <span data-testid="annotation-note-text" className="truncate">{annotation.note}</span>
                            </div>
                        )}
                        <p data-testid="annotation-text" className="text-sm text-gray-800 dark:text-gray-200 line-clamp-3 border-l-2 pl-2" style={{ borderColor: annotation.color }}>
                            {annotation.text}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                            {new Date(annotation.created).toLocaleDateString()}
                        </p>
                      </>
                  )}
              </div>
              <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                 <button
                    data-testid="annotation-edit-button"
                    onClick={(e) => handleEditNote(e, annotation)}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-500"
                    title="Edit Note"
                 >
                    <PenLine className="w-3 h-3" />
                 </button>
                 <button
                    data-testid="annotation-delete-button"
                    onClick={(e) => handleDelete(e, annotation.id)}
                    className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-red-500"
                    title="Delete"
                 >
                    <Trash2 className="w-3 h-3" />
                 </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
