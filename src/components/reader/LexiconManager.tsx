import { useState, useEffect } from 'react';
import { LexiconService } from '../../lib/tts/LexiconService';
import type { LexiconRule } from '../../types/db';
import { Plus, Trash2, Volume2, Save, X } from 'lucide-react';
// import { Button } from '../ui/Button'; // Removed missing import
import { Dialog as UiDialog } from '../ui/Dialog'; // Use default Dialog implementation
import { useReaderStore } from '../../store/useReaderStore';

interface LexiconManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Simple internal Button component since ui/Button doesn't exist
const Button = ({ children, onClick, variant = 'primary', className = '', size = 'default', ...props }: any) => {
    const baseClass = "px-4 py-2 rounded font-medium transition-colors flex items-center justify-center";

    // Quick fix for semantic classes if they don't map directly in this project's tailwind config
    // Actually project uses `bg-blue-500` etc in ReaderSettings, let's stick to simple classes or reuse what works.
    // ReaderSettings uses: bg-gray-100, text-gray-800 etc.
    // Let's use simple utility classes.
    const styleClass = variant === 'primary'
        ? "bg-blue-600 text-white hover:bg-blue-700"
        : variant === 'ghost'
            ? "bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
            : variant === 'outline'
                ? "border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
                : "";

    return (
        <button onClick={onClick} className={`${baseClass} ${styleClass} ${className}`} {...props}>
            {children}
        </button>
    );
};

export function LexiconManager({ open, onOpenChange }: LexiconManagerProps) {
  const [rules, setRules] = useState<LexiconRule[]>([]);
  const [editingRule, setEditingRule] = useState<Partial<LexiconRule> | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const lexiconService = LexiconService.getInstance();

  const currentBookId = useReaderStore(state => state.currentBookId);
  const [scope, setScope] = useState<'global' | 'book'>('global');

  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');

  useEffect(() => {
    if (open) {
      loadRules();
    }
  }, [open, scope, currentBookId]);

  const loadRules = async () => {
    if (scope === 'global') {
        const globals = await lexiconService.getRules();
        setRules(globals);
    } else if (currentBookId) {
        const all = await lexiconService.getRules(currentBookId);
        setRules(all.filter(r => r.bookId === currentBookId));
    } else {
        setRules([]);
    }
  };

  const handleSave = async () => {
    if (!editingRule?.original || !editingRule?.replacement) return;

    await lexiconService.saveRule({
      id: editingRule.id,
      original: editingRule.original,
      replacement: editingRule.replacement,
      isRegex: editingRule.isRegex,
      bookId: scope === 'book' ? (currentBookId || undefined) : undefined
    });

    setIsAdding(false);
    setEditingRule(null);
    loadRules();
  };

  const handleDelete = async (id: string) => {
    await lexiconService.deleteRule(id);
    loadRules();
  };

  const handleTest = () => {
      const tempRules = [...rules];
      if (editingRule && editingRule.original && editingRule.replacement) {
          const idx = tempRules.findIndex(r => r.id === editingRule.id);
          const r = {
              id: editingRule.id || 'temp',
              original: editingRule.original,
              replacement: editingRule.replacement,
              isRegex: editingRule.isRegex,
              bookId: scope === 'book' ? (currentBookId || undefined) : undefined,
              created: 0
          } as LexiconRule;

          if (idx >= 0) tempRules[idx] = r;
          else tempRules.push(r);
      }

      const result = lexiconService.applyLexicon(testInput, tempRules);
      setTestOutput(result);

      const u = new SpeechSynthesisUtterance(result);
      window.speechSynthesis.speak(u);
  };

  // Adapting to existing Dialog structure
  return (
    <UiDialog
        isOpen={open}
        onClose={() => onOpenChange(false)}
        title="Pronunciation Lexicon"
        description="Define custom pronunciation rules for specific words or names."
        footer={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        }
    >
        <div className="flex space-x-4 mb-4 border-b border-gray-200 dark:border-gray-700 pb-2">
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

        <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
          {/* List */}
          <div className="space-y-2">
            {rules.map(rule => (
               <div key={rule.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                   {editingRule?.id === rule.id ? (
                       <div className="flex flex-1 items-center gap-2">
                           <div className="flex flex-col gap-1 w-full">
                               <div className="flex items-center gap-2 w-full">
                                    <input
                                        data-testid="lexicon-input-original"
                                        className="border p-1 rounded flex-1 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        value={editingRule.original}
                                        onChange={e => setEditingRule({...editingRule, original: e.target.value})}
                                        placeholder="Original"
                                    />
                                    <span className="text-gray-500">→</span>
                                    <input
                                        data-testid="lexicon-input-replacement"
                                        className="border p-1 rounded flex-1 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        value={editingRule.replacement}
                                        onChange={e => setEditingRule({...editingRule, replacement: e.target.value})}
                                        placeholder="Replacement"
                                    />
                               </div>
                               <div className="flex items-center justify-between gap-2">
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
                                   <div className="flex gap-2">
                                        <button data-testid="lexicon-save-rule-btn" onClick={handleSave} className="p-1 text-green-600 hover:bg-green-100 rounded"><Save size={18} /></button>
                                        <button data-testid="lexicon-cancel-rule-btn" onClick={() => setEditingRule(null)} className="p-1 text-red-600 hover:bg-red-100 rounded"><X size={18} /></button>
                                   </div>
                               </div>
                           </div>
                       </div>
                   ) : (
                       <>
                           <div className="flex-1 grid grid-cols-2 gap-4">
                               <div className="flex items-center gap-2">
                                   {rule.isRegex && <span data-testid="lexicon-regex-badge" className="text-[10px] uppercase font-bold text-purple-600 border border-purple-200 bg-purple-50 px-1 rounded">Re</span>}
                                   <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{rule.original}</span>
                               </div>
                               <span className="text-sm text-gray-500 dark:text-gray-400">{rule.replacement}</span>
                           </div>
                           <div className="flex gap-2">
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
                   <div className="flex items-center gap-2">
                        <input
                            data-testid="lexicon-input-original"
                            className="border p-1 rounded flex-1 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            value={editingRule?.original || ''}
                            onChange={e => setEditingRule({...editingRule, original: e.target.value})}
                            placeholder="Original"
                            autoFocus
                        />
                        <span className="text-gray-500">→</span>
                        <input
                            data-testid="lexicon-input-replacement"
                            className="border p-1 rounded flex-1 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            value={editingRule?.replacement || ''}
                            onChange={e => setEditingRule({...editingRule, replacement: e.target.value})}
                            placeholder="Replacement"
                        />
                   </div>
                   <div className="flex items-center justify-between gap-2">
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
              <div className="flex gap-2">
                  <input
                      data-testid="lexicon-test-input"
                      className="flex-1 border p-2 rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      placeholder="Type a sentence containing your words..."
                      value={testInput}
                      onChange={e => setTestInput(e.target.value)}
                  />
                  <Button data-testid="lexicon-test-btn" onClick={handleTest} variant="outline" className="p-2">
                      <Volume2 size={18} />
                  </Button>
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
