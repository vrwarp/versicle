import React from 'react';
import type { BookAnnotationGroup } from '../../hooks/useGroupedAnnotations';
import { useBook } from '../../store/selectors';
import { AnnotationCard } from './AnnotationCard';
import { Download, BookOpen, Link } from 'lucide-react';
import { Button } from '../ui/Button';
import { exportNotesToMarkdown } from '../../lib/export-notes';
import { BookCover } from '../library/BookCover';
import { ReassignBookDialog } from './ReassignBookDialog';
import { useAnnotationStore } from '../../store/useAnnotationStore';

interface BookNotesBlockProps {
    group: BookAnnotationGroup;
    onNavigate: (bookId: string, cfiRange: string) => void;
    onOpenBook: (bookId: string) => void;
}

export const BookNotesBlock: React.FC<BookNotesBlockProps> = ({ group, onNavigate, onOpenBook }) => {
    const book = useBook(group.bookId);
    const { update } = useAnnotationStore();
    const [isReassignDialogOpen, setIsReassignDialogOpen] = React.useState(false);

    // Fallback metadata if the book was deleted from inventory
    const title = book?.title || 'Unknown Book';
    const author = book?.author || 'Unknown Author';
    const isUnknown = !book;

    const handleExport = (e: React.MouseEvent) => {
        e.stopPropagation();
        exportNotesToMarkdown(title, group.annotations);
    };

    const handleCoverClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onOpenBook(group.bookId);
    }

    const handleReassign = (newBookId: string) => {
        group.annotations.forEach(ann => {
            update(ann.id, { bookId: newBookId });
        });
    };

    return (
        <div className="bg-card text-card-foreground rounded-xl border shadow-sm overflow-hidden mb-6 flex flex-col" data-testid="book-notes-block">
            {/* Header */}
            <div
                className="bg-muted/30 px-4 py-3 border-b flex items-center justify-between gap-4 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={handleCoverClick}
            >
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-14 shrink-0 shadow-sm rounded overflow-hidden relative border border-border/50 bg-muted flex items-center justify-center">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {book ? <BookCover book={book as any} onDelete={() => { }} onOffload={() => { }} onRestore={() => { }} showActions={false} /> : <BookOpen className="w-6 h-6 text-muted-foreground/30" />}
                        <div className="absolute inset-0 bg-black/10 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                            <BookOpen className="text-white w-4 h-4" />
                        </div>
                    </div>
                    <div className="min-w-0">
                        <h3 className="font-bold text-base truncate" title={title}>{title}</h3>
                        <p className="text-sm text-muted-foreground truncate" title={author}>{author}</p>
                    </div>
                </div>
                <div className="flex gap-2 shrink-0">
                    {isUnknown && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setIsReassignDialogOpen(true); }}
                            className="gap-2 h-8"
                            title="Reassign to known book"
                        >
                            <Link className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Reassign</span>
                        </Button>
                    )}
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleExport}
                        className="gap-2 h-8"
                        title="Export as Markdown"
                    >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Export</span>
                    </Button>
                </div>
            </div>

            {/* Annotations */}
            <div className="flex flex-col">
                {group.annotations.map(ann => (
                    <AnnotationCard
                        key={ann.id}
                        annotation={ann}
                        onNavigate={(cfi) => onNavigate(group.bookId, cfi)}
                    />
                ))}
            </div>

            {isReassignDialogOpen && (
                <ReassignBookDialog
                    isOpen={isReassignDialogOpen}
                    onClose={() => setIsReassignDialogOpen(false)}
                    onConfirm={handleReassign}
                />
            )}
        </div>
    );
};
