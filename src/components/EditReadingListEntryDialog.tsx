import React, { useState, useEffect } from 'react';
import { Modal, ModalContent, ModalHeader, ModalTitle } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "./ui/Select";
import type { ReadingListEntry } from '../types/db';

interface EditReadingListEntryDialogProps {
    /** Whether the dialog is open. */
    open: boolean;
    /** Callback when dialog open state changes. */
    onOpenChange: (open: boolean) => void;
    /** The entry to edit. Null if no entry selected (though dialog shouldn't be open then). */
    entry: ReadingListEntry | null;
    /** Callback when the user saves changes. */
    onSave: (entry: ReadingListEntry) => void;
}

/**
 * Dialog for editing a single reading list entry.
 * Allows modifying title, author, status, and rating.
 */
export const EditReadingListEntryDialog: React.FC<EditReadingListEntryDialogProps> = ({
    open,
    onOpenChange,
    entry,
    onSave,
}) => {
    const [title, setTitle] = useState('');
    const [author, setAuthor] = useState('');
    const [status, setStatus] = useState<'read' | 'currently-reading' | 'to-read'>('to-read');
    const [rating, setRating] = useState<number | undefined>(undefined);

    useEffect(() => {
        if (entry) {
            setTitle(entry.title);
            setAuthor(entry.author);
            setStatus(entry.status || 'to-read');
            setRating(entry.rating);
        }
    }, [entry, open]);

    const handleSave = () => {
        if (!entry) return;
        const updatedEntry: ReadingListEntry = {
            ...entry,
            title,
            author,
            status,
            rating,
            lastUpdated: Date.now(),
        };
        onSave(updatedEntry);
        onOpenChange(false);
    };

    return (
        <Modal open={open} onOpenChange={onOpenChange}>
            <ModalContent className="sm:max-w-[425px]">
                <ModalHeader>
                    <ModalTitle>Edit Entry</ModalTitle>
                </ModalHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="title" className="text-right">
                            Title
                        </Label>
                        <Input
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="author" className="text-right">
                            Author
                        </Label>
                        <Input
                            id="author"
                            value={author}
                            onChange={(e) => setAuthor(e.target.value)}
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="status" className="text-right">
                            Status
                        </Label>
                        <div className="col-span-3">
                            <Select value={status} onValueChange={(val) => setStatus(val as 'read' | 'currently-reading' | 'to-read')}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="to-read">To Read</SelectItem>
                                    <SelectItem value="currently-reading">Reading</SelectItem>
                                    <SelectItem value="read">Read</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="rating" className="text-right">
                            Rating
                        </Label>
                        <div className="col-span-3">
                             <Select
                                value={rating?.toString() || '0'}
                                onValueChange={(val) => setRating(val === '0' ? undefined : parseInt(val))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select rating" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="0">No Rating</SelectItem>
                                    <SelectItem value="1">1 Star</SelectItem>
                                    <SelectItem value="2">2 Stars</SelectItem>
                                    <SelectItem value="3">3 Stars</SelectItem>
                                    <SelectItem value="4">4 Stars</SelectItem>
                                    <SelectItem value="5">5 Stars</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-2 pt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave}>Save changes</Button>
                </div>
            </ModalContent>
        </Modal>
    );
};
