import React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

interface NotesSearchBarProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

export const NotesSearchBar: React.FC<NotesSearchBarProps> = ({ value, onChange, className }) => {
    return (
        <div className={cn("w-full", className)}>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                    type="search"
                    placeholder="Search annotations..."
                    aria-label="Search annotations"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className={cn("pl-9", value && "pr-9")}
                    data-testid="notes-search-input"
                />
                {value && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => onChange('')}
                        aria-label="Clear query"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </div>
        </div>
    );
};
