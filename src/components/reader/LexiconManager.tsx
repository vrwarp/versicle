import { useState, useEffect, useCallback, useRef } from 'react';
import { LexiconService } from '../../lib/tts/LexiconService';
import { AudioPlayerService } from '../../lib/tts/AudioPlayerService';
import type { LexiconRule } from '../../types/db';
import { Plus, Trash2, Save, X, Download, Upload, ArrowUp, ArrowDown, Play, RefreshCw, CornerDownRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { Dialog as UiDialog } from '../ui/Dialog';
import { useReaderStore } from '../../store/useReaderStore';
import { LEXICON_SAMPLE_CSV } from '../../lib/tts/lexiconSample';
import { LexiconCSV } from '../../lib/tts/CsvUtils';

interface LexiconManagerProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Callback to change the open state. */
  onOpenChange: (open: boolean) => void;
  /** Initial term to populate the form (e.g. from context menu). */
  initialTerm?: string;
}

/**
 * Dialog for managing pronunciation lexicon rules.
 * Supports adding, editing, deleting, importing/exporting rules, and testing pronunciation.
 *
 * @param props - Component props.
 * @returns The LexiconManager dialog component.
 */
export function LexiconManager({ open, onOpenChange, initialTerm }: LexiconManagerProps) {
  const [rules, setRules] = useState<LexiconRule[]>([]);
  const [editingRule, setEditingRule] = useState<Partial<LexiconRule> | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const lexiconService = LexiconService.getInstance();

  const currentBookId = useReaderStore(state => state.currentBookId);
  const [scope, setScope] = useState<'global' | 'book'>('global');

  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadRules = useCallback(async () => {
    if (scope === 'global') {
        const globals = await lexiconService.getRules();
        setRules(globals);
    } else if (currentBookId) {
        const all = await lexiconService.getRules(currentBookId);
        setRules(all.filter(r => r.bookId === currentBookId));
    } else {
        setRules([]);
    }
  }, [scope, currentBookId, lexiconService]);

  useEffect(() => {
    if (open) {
      loadRules();
      if (initialTerm) {
          setIsAdding(true);
          setEditingRule({ original: initialTerm, replacement: '' });
          setTestInput(initialTerm);
      }
    }
  }, [open, loadRules, initialTerm]);

  const handleSave = async () => {
    if (!editingRule?.original || !editingRule?.replacement) return;

    // Preserve existing order if editing, or append to end if new
    const existingRule = rules.find(r => r.id === editingRule.id);
    const order = existingRule?.order ?? rules.length;

    await lexiconService.saveRule({
      id: editingRule.id,
      original: editingRule.original,
      replacement: editingRule.replacement,
      isRegex: editingRule.isRegex,
      bookId: scope === 'book' ? (currentBookId || undefined) : undefined,
      applyBeforeGlobal: editingRule.applyBeforeGlobal,
      order
    });

    setIsAdding(false);
    setEditingRule(null);
    loadRules();
  };

  const moveRule = async (index: number, direction: 'up' | 'down') => {
      const newRules = [...rules];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (targetIndex < 0 || targetIndex >= newRules.length) return;

      const temp = newRules[index];
      newRules[index] = newRules[targetIndex];
      newRules[targetIndex] = temp;

      setRules(newRules);

      // Persist order
      const updates = newRules.map((rule, idx) => ({ id: rule.id, order: idx }));
      await lexiconService.reorderRules(updates);
  };

  const handleDelete = async (id: string) => {
    await lexiconService.deleteRule(id);
    loadRules();
  };

  const getTempRules = (useAllRules: boolean) => {
    // If we only use current entry, we ignore the main 'rules' array and only use 'editingRule'
    if (!useAllRules) {
      if (editingRule && editingRule.original && editingRule.replacement) {
        return [{
          id: editingRule.id || 'temp',
          original: editingRule.original,
          replacement: editingRule.replacement,
          isRegex: editingRule.isRegex,
          bookId: scope === 'book' ? (currentBookId || undefined) : undefined,
          applyBeforeGlobal: editingRule.applyBeforeGlobal,
          created: 0,
          order: 0
        } as LexiconRule];
      }
      return [];
    }

    // Use all rules, merging current editing rule
    const tempRules = [...rules];
    if (editingRule && editingRule.original && editingRule.replacement) {
      const idx = tempRules.findIndex(r => r.id === editingRule.id);
      const r = {
        id: editingRule.id || 'temp',
        original: editingRule.original,
        replacement: editingRule.replacement,
        isRegex: editingRule.isRegex,
        bookId: scope === 'book' ? (currentBookId || undefined) : undefined,
        applyBeforeGlobal: editingRule.applyBeforeGlobal,
        created: 0,
        order: idx >= 0 ? tempRules[idx].order : tempRules.length
      } as LexiconRule;

      if (idx >= 0) tempRules[idx] = r;
      else tempRules.push(r);
    }
    return tempRules;
  };

  const performReplacement = (useAllRules: boolean) => {
    const tempRules = getTempRules(useAllRules);
    const result = lexiconService.applyLexicon(testInput, tempRules);
    setTestOutput(result);
    return result;
  };

  const handleReplaceCurrent = () => performReplacement(false);
  const handleReplaceAll = () => performReplacement(true);

  const handlePlay = () => {
    let textToPlay = testOutput;
    // If output is empty, replace using all rules first
    if (!textToPlay) {
      textToPlay = performReplacement(true);
    }

    if (textToPlay) {
      AudioPlayerService.getInstance().preview(textToPlay);
    }
  };

  const handleDownloadSample = () => {
    const blob = new Blob([LEXICON_SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lexicon_sample.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = () => {
    const csv = LexiconCSV.generate(rules);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lexicon_${scope}${scope === 'book' ? '_' + currentBookId : ''}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
          const text = evt.target?.result as string;
          if (text) {
              const newRules = LexiconCSV.parse(text);
              for (const r of newRules) {
                  await lexiconService.saveRule({
                      original: r.original,
                      replacement: r.replacement,
                      isRegex: r.isRegex,
                      bookId: scope === 'book' ? (currentBookId || undefined) : undefined,
                      applyBeforeGlobal: r.applyBeforeGlobal
                  });
              }
              loadRules();
          }
          // Reset input
          if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsText(file);
  };

  return (
    <UiDialog
        isOpen={open}
        onClose={() => onOpenChange(false)}
        title="Pronunciation Lexicon"
        description="Define custom pronunciation rules for specific words or names."
        footer={
            <Button data-testid="lexicon-close-btn" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        }
    >
        <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-gray-700 pb-2 overflow-x-auto gap-4">
            <div className="flex space-x-4 shrink-0">
                <button
                    onClick={() => setScope('global')}
                    className={`pb-1 px-2 ${scope === 'global' ? 'border-b-2 border-blue-500 font-bold text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                >
                    Global
                </button>
                {currentBookId && (
                    <button
                        onClick={() => setScope('book')}
                        className={`pb-1 px-2 ${scope === 'book' ? 'border-b-2 border-blue-500 font-bold text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                    >
                        This Book
                    </button>
                )}
            </div>

            <div className="flex gap-2 shrink-0">
                <Button data-testid="lexicon-download-sample" variant="ghost" size="sm" onClick={handleDownloadSample} title="Download Sample CSV">
                    <Download size={14} className="mr-1" /> Sample
                </Button>
                <Button data-testid="lexicon-export" variant="ghost" size="sm" onClick={handleExport} title="Export to CSV">
                    <Download size={14} className="mr-1" /> Export
                </Button>
                <Button data-testid="lexicon-import-btn" asChild variant="ghost" size="sm" title="Import from CSV">
                    <label className="cursor-pointer flex items-center">
                        <Upload size={14} className="mr-1" /> Import
                        <input data-testid="lexicon-import-input" ref={fileInputRef} type="file" className="hidden" accept=".csv" onChange={handleImport} />
                    </label>
                </Button>
            </div>
        </div>

        <div data-testid="lexicon-list-container" className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
          {/* List */}
          <div data-testid="lexicon-rules-list" className="space-y-2">
            {rules.map((rule, index) => (
               <div key={rule.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                   {editingRule?.id === rule.id ? (
                       <div className="flex flex-1 items-center gap-2">
                           <div className="flex flex-col gap-1 w-full">
                               <div className="flex flex-col gap-2 w-full">
                                    <input
                                        data-testid="lexicon-input-original"
                                        className="border p-1 rounded flex-1 min-w-0 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        value={editingRule.original}
                                        onChange={e => setEditingRule({...editingRule, original: e.target.value})}
                                        placeholder="Original"
                                    />
                                    <div className="flex items-center gap-2 w-full">
                                        <CornerDownRight size={16} className="text-gray-400 shrink-0" />
                                        <input
                                            data-testid="lexicon-input-replacement"
                                            className="border p-1 rounded flex-1 min-w-0 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            value={editingRule.replacement}
                                            onChange={e => setEditingRule({...editingRule, replacement: e.target.value})}
                                            placeholder="Replacement"
                                        />
                                    </div>
                               </div>
                               <div className="flex items-center justify-between gap-2 mt-2">
                                   <div className="flex gap-4">
                                        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                                            <input
                                                data-testid="lexicon-regex-checkbox"
                                                type="checkbox"
                                                checked={editingRule.isRegex || false}
                                                onChange={e => setEditingRule({...editingRule, isRegex: e.target.checked})}
                                                className="rounded border-gray-300 dark:border-gray-600"
                                            />
                                            Regex
                                        </label>
                                        {scope === 'book' && (
                                            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400" title="Apply this rule before global rules">
                                                <input
                                                    data-testid="lexicon-priority-checkbox"
                                                    type="checkbox"
                                                    checked={editingRule.applyBeforeGlobal || false}
                                                    onChange={e => setEditingRule({...editingRule, applyBeforeGlobal: e.target.checked})}
                                                    className="rounded border-gray-300 dark:border-gray-600"
                                                />
                                                High Priority
                                            </label>
                                        )}
                                   </div>
                                   <div className="flex gap-2">
                                        <button data-testid="lexicon-save-rule-btn" onClick={handleSave} className="p-1 text-green-600 hover:bg-green-100 rounded"><Save size={18} /></button>
                                        <button data-testid="lexicon-cancel-rule-btn" onClick={() => setEditingRule(null)} className="p-1 text-red-600 hover:bg-red-100 rounded"><X size={18} /></button>
                                   </div>
                               </div>
                           </div>
                       </div>
                   ) : (
                       <>
                           <div className="flex-1 flex flex-col gap-1 min-w-0 py-1">
                               <div className="flex items-baseline gap-2 flex-wrap">
                                   {rule.isRegex && <span data-testid="lexicon-regex-badge" className="text-[10px] uppercase font-bold text-purple-600 border border-purple-200 bg-purple-50 px-1 rounded shrink-0">Re</span>}
                                   {rule.applyBeforeGlobal && <span data-testid="lexicon-priority-badge" className="text-[10px] uppercase font-bold text-orange-600 border border-orange-200 bg-orange-50 px-1 rounded shrink-0">Pre</span>}
                                   <span className="font-mono text-sm break-all text-gray-900 dark:text-gray-100">{rule.original}</span>
                               </div>
                               <div className="flex items-center gap-2 pl-1">
                                   <CornerDownRight size={14} className="text-gray-400 shrink-0" />
                                   <span className="font-semibold text-gray-800 dark:text-gray-300 text-sm break-words">{rule.replacement}</span>
                               </div>
                           </div>
                           <div className="flex gap-2 items-center">
                               <div className="flex flex-col mr-2">
                                   <button
                                       data-testid={`lexicon-move-up-${index}`}
                                       onClick={() => moveRule(index, 'up')}
                                       disabled={index === 0}
                                       className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                   >
                                       <ArrowUp size={12} />
                                   </button>
                                   <button
                                       data-testid={`lexicon-move-down-${index}`}
                                       onClick={() => moveRule(index, 'down')}
                                       disabled={index === rules.length - 1}
                                       className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                   >
                                       <ArrowDown size={12} />
                                   </button>
                               </div>
                               <button onClick={() => setEditingRule(rule)} className="text-xs text-blue-600 hover:underline">Edit</button>
                               <button onClick={() => handleDelete(rule.id)} className="text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20 p-1 rounded"><Trash2 size={16}/></button>
                           </div>
                       </>
                   )}
               </div>
            ))}

            {rules.length === 0 && !isAdding && (
                <div className="text-center py-8 text-gray-400 text-sm">
                    No rules defined for this scope.
                </div>
            )}
          </div>

          {/* Add New */}
          {isAdding ? (
              <div className="flex flex-col gap-2 p-2 border rounded bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                   <div className="flex flex-col gap-2">
                        <input
                            data-testid="lexicon-input-original"
                            className="border p-1 rounded flex-1 min-w-0 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            value={editingRule?.original || ''}
                            onChange={e => setEditingRule({...editingRule, original: e.target.value})}
                            placeholder="Original"
                            autoFocus
                        />
                        <div className="flex items-center gap-2">
                            <CornerDownRight size={16} className="text-gray-400 shrink-0" />
                            <input
                                data-testid="lexicon-input-replacement"
                                className="border p-1 rounded flex-1 min-w-0 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                value={editingRule?.replacement || ''}
                                onChange={e => setEditingRule({...editingRule, replacement: e.target.value})}
                                placeholder="Replacement"
                            />
                        </div>
                   </div>
                   <div className="flex items-center justify-between gap-2 mt-2">
                       <div className="flex gap-4">
                           <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                               <input
                                   data-testid="lexicon-regex-checkbox"
                                   type="checkbox"
                                   checked={editingRule?.isRegex || false}
                                   onChange={e => setEditingRule({...editingRule, isRegex: e.target.checked})}
                                   className="rounded border-gray-300 dark:border-gray-600"
                               />
                               Regex
                           </label>
                           {scope === 'book' && (
                                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400" title="Apply this rule before global rules">
                                    <input
                                        data-testid="lexicon-priority-checkbox"
                                        type="checkbox"
                                        checked={editingRule?.applyBeforeGlobal || false}
                                        onChange={e => setEditingRule({...editingRule, applyBeforeGlobal: e.target.checked})}
                                        className="rounded border-gray-300 dark:border-gray-600"
                                    />
                                    High Priority
                                </label>
                           )}
                       </div>
                       <div className="flex gap-2">
                            <button data-testid="lexicon-save-rule-btn" onClick={handleSave} className="p-1 text-green-600 hover:bg-green-100 rounded"><Save size={18} /></button>
                            <button data-testid="lexicon-cancel-rule-btn" onClick={() => { setIsAdding(false); setEditingRule(null); }} className="p-1 text-red-600 hover:bg-red-100 rounded"><X size={18} /></button>
                       </div>
                   </div>
              </div>
          ) : (
              <Button data-testid="lexicon-add-rule-btn" onClick={() => { setIsAdding(true); setEditingRule({}); }} variant="outline" className="w-full flex items-center justify-center gap-2 text-sm">
                  <Plus size={16} /> Add Rule
              </Button>
          )}

          {/* Test Area */}
          <div className="mt-8 pt-4 border-t border-gray-100 dark:border-gray-700">
              <h4 className="text-xs font-semibold mb-2 text-gray-500 uppercase">Test Pronunciation</h4>
              <div className="flex flex-col gap-2">
                  <input
                      data-testid="lexicon-test-input"
                      className="w-full border p-2 rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      placeholder="Type a sentence containing your words..."
                      value={testInput}
                      onChange={e => setTestInput(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                      <Button
                          data-testid="lexicon-test-current-btn"
                          onClick={handleReplaceCurrent}
                          variant="outline"
                          size="sm"
                          disabled={!editingRule}
                          title="Replace using only the current rule being edited"
                      >
                          <RefreshCw size={14} className="mr-2" /> Current
                      </Button>
                      <Button
                          data-testid="lexicon-test-all-btn"
                          onClick={handleReplaceAll}
                          variant="outline"
                          size="sm"
                          title="Replace using all rules (including current edits)"
                      >
                          <RefreshCw size={14} className="mr-2" /> All Rules
                      </Button>
                      <Button
                          data-testid="lexicon-play-btn"
                          onClick={handlePlay}
                          variant="outline"
                          size="sm"
                          title="Play the processed text"
                      >
                          <Play size={14} className="mr-2" /> Play
                      </Button>
                  </div>
              </div>
              {testOutput && (
                  <div className="mt-2 text-sm text-gray-500">
                      Processed: <span className="italic text-gray-900 dark:text-gray-100">{testOutput}</span>
                  </div>
              )}
          </div>
        </div>
    </UiDialog>
  );
}
