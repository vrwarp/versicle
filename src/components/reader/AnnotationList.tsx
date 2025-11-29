import React from 'react';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { Trash2, StickyNote, PenLine, MessageSquarePlus } from 'lucide-react';
import type { Annotation } from '../../types/db';

interface Props {
  onNavigate: (cfi: string) => void;
}

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
    return (
        <div className="flex flex-col items-center justify-center p-8 text-center h-full text-muted">
            <MessageSquarePlus className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-sm font-medium">No annotations yet</p>
            <p className="text-xs mt-2">Select text in the book to highlight it or add a note.</p>
        </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <ul className="divide-y divide-border">
        {annotations.map((annotation) => (
          <li key={annotation.id} data-testid={`annotation-item-${annotation.id}`} className="p-3 hover:bg-muted/10 cursor-pointer group transition-colors" onClick={() => onNavigate(annotation.cfiRange)}>
            <div className="flex justify-between items-start gap-2">
              <div className="flex-1 min-w-0">
                  {editingId === annotation.id ? (
                      <div className="mb-2" onClick={(e) => e.stopPropagation()}>
                          <input
                             data-testid="annotation-note-input"
                             type="text"
                             value={editNoteText}
                             onChange={(e) => setEditNoteText(e.target.value)}
                             className="w-full text-xs p-1 border rounded bg-background text-foreground border-border mb-1"
                             autoFocus
                             onKeyDown={(e) => {
                                 if (e.key === 'Enter') saveEdit(annotation.id);
                                 if (e.key === 'Escape') setEditingId(null);
                             }}
                          />
                          <div className="flex gap-1">
                              <button data-testid="annotation-save-button" onClick={() => saveEdit(annotation.id)} className="text-xs bg-primary text-background px-2 py-1 rounded">Save</button>
                              <button data-testid="annotation-cancel-button" onClick={() => setEditingId(null)} className="text-xs bg-secondary text-surface px-2 py-1 rounded">Cancel</button>
                          </div>
                      </div>
                  ) : (
                      <>
                        {annotation.note && (
                            <div className="text-xs text-secondary mb-1 flex items-center gap-1">
                                <StickyNote className="w-3 h-3" />
                                <span data-testid="annotation-note-text" className="truncate font-medium">{annotation.note}</span>
                            </div>
                        )}
                        <p data-testid="annotation-text" className="text-sm text-foreground line-clamp-3 border-l-2 pl-2" style={{ borderColor: annotation.color }}>
                            {annotation.text}
                        </p>
                        <p className="text-[10px] text-muted mt-1">
                            {new Date(annotation.created).toLocaleDateString()}
                        </p>
                      </>
                  )}
              </div>
              <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                 <button
                    data-testid="annotation-edit-button"
                    onClick={(e) => handleEditNote(e, annotation)}
                    className="p-1 hover:bg-muted rounded text-secondary"
                    title="Edit Note"
                 >
                    <PenLine className="w-3 h-3" />
                 </button>
                 <button
                    data-testid="annotation-delete-button"
                    onClick={(e) => handleDelete(e, annotation.id)}
                    className="p-1 hover:bg-destructive/10 rounded text-destructive"
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
