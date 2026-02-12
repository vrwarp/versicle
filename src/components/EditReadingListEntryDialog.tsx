import React, { useState } from 'react';
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
import { Star, BookOpen, Check, Clock, Ban } from 'lucide-react';
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
    const [title, setTitle] = useState(entry?.title || '');
    const [author, setAuthor] = useState(entry?.author || '');
    const [status, setStatus] = useState<'read' | 'currently-reading' | 'to-read'>(entry?.status || 'to-read');
    const [rating, setRating] = useState<number | undefined>(entry?.rating);

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

    const renderStars = (count: number) => {
        return Array(count).fill(0).map((_, i) => (
            <Star key={i} className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
        ));
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
                                <SelectTrigger id="status">
                                    <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="to-read">
                                        <div className="flex items-center gap-2">
                                            <Clock className="w-4 h-4 text-muted-foreground" />
                                            <span>To Read</span>
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="currently-reading">
                                        <div className="flex items-center gap-2">
                                            <BookOpen className="w-4 h-4 text-blue-500" />
                                            <span>Reading</span>
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="read">
                                        <div className="flex items-center gap-2">
                                            <Check className="w-4 h-4 text-green-500" />
                                            <span>Read</span>
                                        </div>
                                    </SelectItem>
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
                                <SelectTrigger id="rating">
                                    <SelectValue placeholder="Select rating" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="0">
                                        <div className="flex items-center gap-2">
                                            <Ban className="w-4 h-4 text-muted-foreground" />
                                            <span>No Rating</span>
                                        </div>
                                    </SelectItem>
                                    {[1, 2, 3, 4, 5].map((stars) => (
                                        <SelectItem key={stars} value={stars.toString()}>
                                            <div className="flex items-center gap-2">
                                                <div className="flex gap-0.5">
                                                    {renderStars(stars)}
                                                </div>
                                                <span className="text-muted-foreground text-xs ml-1">({stars} Star{stars > 1 ? 's' : ''})</span>
                                            </div>
                                        </SelectItem>
                                    ))}
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
