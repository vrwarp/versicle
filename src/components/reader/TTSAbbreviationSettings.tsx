import React, { useState, useRef } from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_ALWAYS_MERGE, DEFAULT_SENTENCE_STARTERS } from '../../lib/tts/TextSegmenter';
import { X, Plus, RotateCcw, Download, Upload } from 'lucide-react';
import { SimpleListCSV } from '../../lib/tts/CsvUtils';

interface StringListManagerProps {
    /** Title of the list section. */
    title: string;
    /** Description/Help text. */
    description: string;
    /** The list of string items. */
    items: string[];
    /** Callback to update the list. */
    onItemsChange: (items: string[]) => void;
    /** Default list for reset. */
    defaults: string[];
    /** Placeholder for the input field. */
    placeholder: string;
    /** Header used for CSV import/export. */
    importHeader: string;
    /** Filename for export. */
    exportFilename: string;
}

/**
 * A generic component to manage a list of strings (add, remove, reset, import/export).
 */
const StringListManager: React.FC<StringListManagerProps> = ({
    title, description, items, onItemsChange, defaults, placeholder, importHeader, exportFilename
}) => {
    const [newItem, setNewItem] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleAdd = () => {
        if (!newItem.trim()) return;
        if (items.includes(newItem.trim())) {
            setNewItem('');
            return;
        }

        onItemsChange([...items, newItem.trim()]);
        setNewItem('');
    };

    const handleRemove = (item: string) => {
        onItemsChange(items.filter(i => i !== item));
    };

    const handleReset = () => {
        onItemsChange(defaults);
    };

    const handleDownload = () => {
        const csvContent = SimpleListCSV.generate(items, importHeader);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', exportFilename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            if (!text) return;

            const lines = SimpleListCSV.parse(text, importHeader);

            if (lines.length === 0) {
                alert('No items found in file.');
                return;
            }

            if (window.confirm(`This will replace your current list with ${lines.length} entries from the file. Are you sure?`)) {
                onItemsChange(lines);
            }

            // Reset input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        };
        reader.readAsText(file);
    };

    return (
        <div className="mb-6 last:mb-0">
            <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-1 uppercase">{title}</h4>
                <p className="text-[10px] text-muted-foreground mb-2">
                    {description}
                </p>

                <div className="flex gap-2 mb-2">
                    <input
                        type="text"
                        value={newItem}
                        onChange={(e) => setNewItem(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        placeholder={placeholder}
                        className="flex-1 text-xs p-1 border rounded bg-background text-foreground border-border"
                    />
                    <button
                        onClick={handleAdd}
                        disabled={!newItem.trim()}
                        className="p-1 bg-primary text-background rounded hover:opacity-90 disabled:opacity-50"
                        aria-label={`Add to ${title}`}
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-1 border border-border rounded bg-muted/20 mb-2">
                    {items.length === 0 && (
                         <span className="text-[10px] text-muted-foreground p-1">No items set.</span>
                    )}
                    {items.map((item) => (
                        <div key={item} className="flex items-center gap-1 bg-background border border-border px-2 py-1 rounded text-xs">
                            <span>{item}</span>
                            <button
                                onClick={() => handleRemove(item)}
                                className="text-muted-foreground hover:text-red-500"
                                aria-label={`Remove ${item}`}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex justify-between items-center">
                <button
                    onClick={handleReset}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                    <RotateCcw className="w-3 h-3" />
                    Reset
                </button>

                <div className="flex gap-2">
                     <button
                        onClick={handleDownload}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        title="Download CSV"
                    >
                        <Download className="w-3 h-3" />
                        Export
                    </button>
                    <button
                        onClick={handleUploadClick}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        title="Upload CSV"
                    >
                        <Upload className="w-3 h-3" />
                        Import
                    </button>
                    <input
                        type="file"
                        accept=".csv"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                        data-testid={`csv-upload-${title.toLowerCase().replace(/\s+/g, '-')}`}
                    />
                </div>
            </div>
        </div>
    );
};

/**
 * Settings component for configuring TTS text segmentation rules.
 * Manages abbreviations, merge rules, and sentence starters.
 */
export const TTSAbbreviationSettings: React.FC = () => {
    const {
        customAbbreviations, setCustomAbbreviations,
        alwaysMerge, setAlwaysMerge,
        sentenceStarters, setSentenceStarters
    } = useTTSStore(useShallow(state => ({
        // Optimization: Prevent re-renders on TTS playback ticks
        customAbbreviations: state.customAbbreviations,
        setCustomAbbreviations: state.setCustomAbbreviations,
        alwaysMerge: state.alwaysMerge,
        setAlwaysMerge: state.setAlwaysMerge,
        sentenceStarters: state.sentenceStarters,
        setSentenceStarters: state.setSentenceStarters
    })));

    const defaultAbbreviations = [
        'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Gen.', 'Rep.', 'Sen.', 'St.', 'vs.', 'Jr.', 'Sr.',
        'e.g.', 'i.e.'
    ];

    return (
        <div className="space-y-4">
            <StringListManager
                title="Abbreviations"
                description="These abbreviations will not trigger a new sentence when followed by a period."
                items={customAbbreviations}
                onItemsChange={setCustomAbbreviations}
                defaults={defaultAbbreviations}
                placeholder="e.g. Dr."
                importHeader="Abbreviation"
                exportFilename="abbreviations.csv"
            />

            <StringListManager
                title="Always Merge"
                description="Words that ALWAYS merge with the next sentence (e.g. titles)."
                items={alwaysMerge}
                onItemsChange={setAlwaysMerge}
                defaults={DEFAULT_ALWAYS_MERGE}
                placeholder="e.g. Mr."
                importHeader="AlwaysMerge"
                exportFilename="always_merge.csv"
            />

            <StringListManager
                title="Sentence Starters"
                description="Words that force a split (start new sentence) if they follow an abbreviation."
                items={sentenceStarters}
                onItemsChange={setSentenceStarters}
                defaults={DEFAULT_SENTENCE_STARTERS}
                placeholder="e.g. He"
                importHeader="SentenceStarter"
                exportFilename="sentence_starters.csv"
            />
        </div>
    );
};
