import React, { useState, useEffect } from 'react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { useReadingListStore } from '../store/useReadingListStore';
import { useBookStore } from '../store/useBookStore';
import { genAIService } from '../lib/genai/GenAIService';
import { Loader2, Wand2, Link2, Unlink } from 'lucide-react';
import { useGenAIStore } from '../store/useGenAIStore';

interface SmartLinkDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface MappingResult {
    readingListFilename: string;
    libraryBookId: string;
}

export const SmartLinkDialog: React.FC<SmartLinkDialogProps> = ({ open, onOpenChange }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [mappings, setMappings] = useState<MappingResult[]>([]);
    const [selectedMappings, setSelectedMappings] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);

    const readingListEntries = useReadingListStore(state => state.entries);
    const libraryBooks = useBookStore(state => state.books);
    const isGenAIEnabled = useGenAIStore(state => state.isEnabled);

    // Identify unmapped entries and books
    const unmappedEntries = Object.values(readingListEntries || {}).filter(entry => {
        // Entry is unmapped if no library book has its sourceFilename equal to entry.filename
        return !Object.values(libraryBooks || {}).some(book => book.sourceFilename === entry.filename);
    });

    const unmappedBooks = Object.values(libraryBooks || {}).filter(book => {
        // Book is unmapped if no reading list entry has its filename equal to book.sourceFilename
        return !Object.values(readingListEntries || {}).some(entry => entry.filename === book.sourceFilename);
    });

    useEffect(() => {
        if (!open) {
            // Reset state when closed
            setMappings([]);
            setSelectedMappings(new Set());
            setError(null);
            setIsLoading(false);
            return;
        }

        const runMapping = async () => {
            if (unmappedEntries.length === 0 || unmappedBooks.length === 0) {
                setMappings([]);
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const prompt = `
You are a helpful assistant that maps orphan reading list entries to unmapped library books based on their titles and authors.

Here are the unmapped reading list entries:
${unmappedEntries.map(e => `- ID: ${e.filename}, Title: "${e.title}", Author: "${e.author}"`).join('\n')}

Here are the unmapped library books:
${unmappedBooks.map(b => `- ID: ${b.bookId}, Title: "${b.title}", Author: "${b.author}", Filename: "${b.sourceFilename || 'N/A'}"`).join('\n')}

Find all pairs where the reading list entry matches the library book. Return a JSON object with a 'mappings' array containing the pairs.
Only include matches you are highly confident about.
`;
                const schema = {
                    type: "OBJECT",
                    properties: {
                        mappings: {
                            type: "ARRAY",
                            items: {
                                type: "OBJECT",
                                properties: {
                                    readingListFilename: { type: "STRING" },
                                    libraryBookId: { type: "STRING" }
                                },
                                required: ["readingListFilename", "libraryBookId"]
                            }
                        }
                    },
                    required: ["mappings"]
                };

                const result = await genAIService.generateStructured<{ mappings: MappingResult[] }>(prompt, schema);

                // Filter mappings to ensure they are valid
                const validMappings = (result.mappings || []).filter(m => {
                    const entryExists = unmappedEntries.some(e => e.filename === m.readingListFilename);
                    const bookExists = unmappedBooks.some(b => b.bookId === m.libraryBookId);
                    return entryExists && bookExists;
                });

                setMappings(validMappings);
                setSelectedMappings(new Set(validMappings.map(m => m.readingListFilename)));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (err: any) {
                console.error("Failed to generate mappings:", err);
                setError(err.message || "An error occurred while matching books.");
            } finally {
                setIsLoading(false);
            }
        };

        if (isGenAIEnabled && open && mappings.length === 0 && !isLoading && !error) {
            runMapping();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleToggleSelection = (filename: string) => {
        const newSet = new Set(selectedMappings);
        if (newSet.has(filename)) {
            newSet.delete(filename);
        } else {
            newSet.add(filename);
        }
        setSelectedMappings(newSet);
    };

    const handleApply = () => {
        const store = useReadingListStore.getState();
        const books = useBookStore.getState().books;

        mappings.forEach(mapping => {
            if (selectedMappings.has(mapping.readingListFilename)) {
                const oldEntry = store.entries[mapping.readingListFilename];
                const libraryBook = books[mapping.libraryBookId];

                if (oldEntry && libraryBook && libraryBook.sourceFilename) {
                    // Add new entry with updated filename
                    store.addEntry({
                        ...oldEntry,
                        filename: libraryBook.sourceFilename
                    });
                    // Remove old entry
                    store.removeEntry(oldEntry.filename);
                }
            }
        });

        onOpenChange(false);
    };

    return (
        <Dialog
            isOpen={open}
            onClose={() => onOpenChange(false)}
            title="Smart Link Books"
            className="sm:max-w-2xl"
            footer={
                <>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        disabled={isLoading || mappings.length === 0 || selectedMappings.size === 0}
                        onClick={handleApply}
                    >
                        Apply Selected ({selectedMappings.size})
                    </Button>
                </>
            }
        >
            <div className="flex-1 overflow-auto p-4 flex flex-col h-[60vh]">
                <p className="text-sm text-muted-foreground mb-4">
                    GenAI can suggest links between reading list entries and books in your library that might not have matched exactly by filename.
                </p>

                {isLoading ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center">
                        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                        <p className="text-sm text-muted-foreground">Analyzing your library...</p>
                    </div>
                ) : error ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center text-destructive">
                        <Unlink className="w-8 h-8 mb-4 opacity-50" />
                        <p className="text-sm">{error}</p>
                    </div>
                ) : mappings.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground">
                        <Link2 className="w-8 h-8 mb-4 opacity-50" />
                        <p className="text-sm">No suggested mappings found.</p>
                        {unmappedEntries.length === 0 && <p className="text-xs mt-2 opacity-80">All reading list entries are already linked.</p>}
                        {unmappedBooks.length === 0 && <p className="text-xs mt-2 opacity-80">All library books are already linked.</p>}
                    </div>
                ) : (
                    <div className="flex-1 overflow-auto">
                        <div className="space-y-3">
                            {mappings.map((mapping) => {
                                const entry = unmappedEntries.find(e => e.filename === mapping.readingListFilename);
                                const book = unmappedBooks.find(b => b.bookId === mapping.libraryBookId);
                                if (!entry || !book) return null;

                                return (
                                    <div key={mapping.readingListFilename} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/5 transition-colors">
                                        <div className="mt-1">
                                            <Checkbox
                                                checked={selectedMappings.has(mapping.readingListFilename)}
                                                onCheckedChange={() => handleToggleSelection(mapping.readingListFilename)}
                                                aria-label={`Select mapping for ${entry.title}`}
                                            />
                                        </div>
                                        <div className="flex-1 grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
                                            <div className="text-sm min-w-0">
                                                <p className="font-medium truncate" title={entry.title}>{entry.title}</p>
                                                <p className="text-muted-foreground truncate" title={entry.author}>{entry.author}</p>
                                                <p className="text-xs text-muted-foreground/70 mt-1">Reading List</p>
                                            </div>
                                            <Link2 className="w-4 h-4 shrink-0 text-muted-foreground" />
                                            <div className="text-sm min-w-0">
                                                <p className="font-medium truncate" title={book.title}>{book.title}</p>
                                                <p className="text-muted-foreground truncate" title={book.author}>{book.author}</p>
                                                <p className="text-xs text-muted-foreground/70 mt-1">Library</p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </Dialog>
    );
};
