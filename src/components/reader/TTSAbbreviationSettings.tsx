import React, { useState } from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { X, Plus, RotateCcw } from 'lucide-react';

export const TTSAbbreviationSettings: React.FC = () => {
    const { customAbbreviations, setCustomAbbreviations } = useTTSStore();
    const [newAbbrev, setNewAbbrev] = useState('');

    const handleAdd = () => {
        if (!newAbbrev.trim()) return;
        if (customAbbreviations.includes(newAbbrev.trim())) {
            setNewAbbrev('');
            return;
        }

        setCustomAbbreviations([...customAbbreviations, newAbbrev.trim()]);
        setNewAbbrev('');
    };

    const handleRemove = (abbrev: string) => {
        setCustomAbbreviations(customAbbreviations.filter(a => a !== abbrev));
    };

    const handleReset = () => {
        // Default abbreviations
        const defaults = [
            'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Gen.', 'Rep.', 'Sen.', 'St.', 'vs.', 'Jr.', 'Sr.',
            'e.g.', 'i.e.'
        ];
        setCustomAbbreviations(defaults);
    };

    return (
        <div className="space-y-4">
            <div>
                <h4 className="text-xs font-semibold text-muted mb-2 uppercase">Sentence Segmentation</h4>
                <p className="text-[10px] text-muted mb-3">
                    These abbreviations will not trigger a new sentence when followed by a period.
                </p>

                <div className="flex gap-2 mb-3">
                    <input
                        type="text"
                        value={newAbbrev}
                        onChange={(e) => setNewAbbrev(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        placeholder="e.g. Dr."
                        className="flex-1 text-xs p-1 border rounded bg-background text-foreground border-border"
                    />
                    <button
                        onClick={handleAdd}
                        disabled={!newAbbrev.trim()}
                        className="p-1 bg-primary text-background rounded hover:opacity-90 disabled:opacity-50"
                        aria-label="Add abbreviation"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-1 border border-border rounded bg-muted/20">
                    {customAbbreviations.length === 0 && (
                         <span className="text-[10px] text-muted p-1">No abbreviations set.</span>
                    )}
                    {customAbbreviations.map((abbrev) => (
                        <div key={abbrev} className="flex items-center gap-1 bg-background border border-border px-2 py-1 rounded text-xs">
                            <span>{abbrev}</span>
                            <button
                                onClick={() => handleRemove(abbrev)}
                                className="text-muted hover:text-red-500"
                                aria-label={`Remove ${abbrev}`}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="pt-2 border-t border-border">
                <button
                    onClick={handleReset}
                    className="flex items-center gap-2 text-xs text-muted hover:text-foreground transition-colors"
                >
                    <RotateCcw className="w-3 h-3" />
                    Reset to Defaults
                </button>
            </div>
        </div>
    );
};
