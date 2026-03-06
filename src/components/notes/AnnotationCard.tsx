import React, { useState } from 'react';
import type { UserAnnotation } from '../../types/db';
import { StickyNote, PenLine, Trash2, Copy } from 'lucide-react';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { copyAnnotationAsMarkdown } from '../../lib/export-notes';
import { useToastStore } from '../../store/useToastStore';

interface AnnotationCardProps {
    annotation: UserAnnotation;
    onNavigate: (cfiRange: string) => void;
}

export const AnnotationCard: React.FC<AnnotationCardProps> = ({ annotation, onNavigate }) => {
    const { remove, update } = useAnnotationStore();
    const showToast = useToastStore(state => state.showToast);
    const [isEditing, setIsEditing] = useState(false);
    const [editNoteText, setEditNoteText] = useState(annotation.note || '');

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Delete this annotation?')) {
            remove(annotation.id);
        }
    };

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await copyAnnotationAsMarkdown(annotation);
            showToast('Copied to clipboard', 'success');
        } catch {
            showToast('Failed to copy', 'error');
        }
    };

    const handleEditClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditing(true);
        setEditNoteText(annotation.note || '');
    };

    const handleSaveEdit = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        update(annotation.id, { note: editNoteText });
        setIsEditing(false);
    };

    const handleCancelEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditing(false);
    };

    return (
        <div
            className="p-4 hover:bg-accent/50 cursor-pointer group transition-colors flex justify-between items-start gap-4 border-b border-border last:border-0"
            onClick={() => onNavigate(annotation.cfiRange)}
            role="button"
            tabIndex={0}
            data-testid={`annotation-card-${annotation.id}`}
            onKeyDown={(e) => { if (e.key === 'Enter') onNavigate(annotation.cfiRange); }}
        >
            <div className="flex-1 min-w-0">
                {isEditing ? (
                    <div className="mb-2" onClick={(e) => e.stopPropagation()}>
                        <label htmlFor={`edit-note-${annotation.id}`} className="sr-only">Edit note</label>
                        <input
                            id={`edit-note-${annotation.id}`}
                            type="text"
                            value={editNoteText}
                            onChange={(e) => setEditNoteText(e.target.value)}
                            className="w-full text-sm p-2 border rounded bg-background text-foreground border-input mb-2"
                            autoFocus
                            placeholder="Add a note..."
                            aria-label="Edit note"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEdit();
                                if (e.key === 'Escape') {
                                    e.stopPropagation();
                                    setIsEditing(false);
                                }
                            }}
                        />
                        <div className="flex gap-2">
                            <button onClick={handleSaveEdit} className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded font-medium">Save</button>
                            <button onClick={handleCancelEdit} className="text-xs bg-muted text-muted-foreground px-3 py-1.5 rounded font-medium">Cancel</button>
                        </div>
                    </div>
                ) : (
                    <>
                        <p
                            className="text-sm text-muted-foreground italic line-clamp-4 border-l-4 pl-3"
                            style={{ borderColor: annotation.color === 'yellow' ? '#facc15' : annotation.color === 'green' ? '#4ade80' : annotation.color === 'blue' ? '#60a5fa' : annotation.color === 'red' ? '#f87171' : annotation.color }}
                        >
                            {annotation.text}
                        </p>
                        {annotation.note && (
                            <div className="mt-2 text-sm text-foreground flex items-start gap-1.5">
                                <StickyNote className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                                <span>{annotation.note}</span>
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                            {new Date(annotation.created).toLocaleDateString()}
                        </p>
                    </>
                )}
            </div>

            <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                <button
                    onClick={handleCopy}
                    className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy as Markdown"
                >
                    <Copy className="w-4 h-4" />
                </button>
                <button
                    onClick={handleEditClick}
                    className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit Note"
                >
                    <PenLine className="w-4 h-4" />
                </button>
                <button
                    onClick={handleDelete}
                    className="p-1.5 hover:bg-destructive/10 rounded text-destructive transition-colors"
                    title="Delete"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};
