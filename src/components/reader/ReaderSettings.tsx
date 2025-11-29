import React from 'react';
import { useReaderStore } from '../../store/useReaderStore';
import { useTTSStore } from '../../store/useTTSStore';
import { SettingsSectionHeader } from '../ui/SettingsSectionHeader';
import { X, Trash2 } from 'lucide-react';
import { getDB } from '../../db/db';

interface ReaderSettingsProps {
  onClose: () => void;
}

export const ReaderSettings: React.FC<ReaderSettingsProps> = ({ onClose }) => {
  const {
    currentTheme,
    setTheme,
    customTheme,
    setCustomTheme,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    lineHeight,
    setLineHeight,
    reset: resetReader,
    currentBookId
  } = useReaderStore();

  const {
    rate,
    setRate,
    voice,
    setVoice,
    voices: availableVoices
  } = useTTSStore();

  const fontOptions = [
    { label: 'Serif', value: 'Merriweather, Georgia, serif' },
    { label: 'Sans-Serif', value: 'Roboto, Helvetica, Arial, sans-serif' },
    { label: 'Monospace', value: 'Consolas, Monaco, monospace' },
    { label: 'Dyslexic', value: 'OpenDyslexic, sans-serif' },
  ];

  const handleClearStorage = async () => {
    if (confirm('Are you sure you want to clear progress and settings for this book?')) {
        if (currentBookId) {
             const db = await getDB();
             const tx = db.transaction('books', 'readwrite');
             const store = tx.objectStore('books');
             const book = await store.get(currentBookId);
             if (book) {
                 book.currentCfi = '';
                 book.progress = 0;
                 await store.put(book);
             }
             await tx.done;
             // We could also clear annotations if requested, but plan just says "Storage, Reset".
             // Reset reader store
             resetReader();
             window.location.reload();
        }
    }
  };

  const handleResetSettings = () => {
      if (confirm('Reset all display settings to default?')) {
          setTheme('light');
          setFontSize(100);
          setLineHeight(1.5);
          setFontFamily('serif');
      }
  };

  return (
    <div data-testid="settings-panel" className="absolute top-14 right-4 w-72 bg-white dark:bg-gray-800 shadow-xl rounded-lg border border-gray-200 dark:border-gray-700 z-30 flex flex-col max-h-[80vh] overflow-y-auto">
      <div className="flex justify-between items-center p-4 border-b border-gray-100 dark:border-gray-700">
        <h3 className="text-sm font-bold dark:text-white">Reader Settings</h3>
        <button data-testid="settings-close-button" onClick={onClose} aria-label="Close Settings">
          <X className="w-4 h-4 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300" />
        </button>
      </div>

      <div className="p-4 space-y-6">

        <SettingsSectionHeader title="Display" />

        {/* Theme Selection */}
        <div>
          <label className="block text-xs text-gray-500 mb-2">Theme</label>
          <div className="flex gap-2 mb-3">
            {(['light', 'dark', 'sepia', 'custom'] as const).map((theme) => (
              <button
                key={theme}
                data-testid={`settings-theme-${theme}`}
                onClick={() => setTheme(theme)}
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${
                  currentTheme === theme ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300 dark:border-gray-600'
                }`}
                style={{
                  background:
                    theme === 'light' ? '#fff' :
                    theme === 'dark' ? '#1a1a1a' :
                    theme === 'sepia' ? '#f4ecd8' :
                    customTheme.bg
                }}
                aria-label={`Select ${theme} theme`}
                title={theme.charAt(0).toUpperCase() + theme.slice(1)}
              >
                {currentTheme === theme && (
                   <span className={`block w-2 h-2 rounded-full ${theme === 'light' || theme === 'sepia' || (theme === 'custom' && customTheme.bg === '#ffffff') ? 'bg-blue-500' : 'bg-white'}`} />
                )}
              </button>
            ))}
          </div>

          {/* Custom Theme Colors */}
          {currentTheme === 'custom' && (
            <div className="grid grid-cols-2 gap-2 p-3 bg-gray-50 dark:bg-gray-750 rounded border border-gray-100 dark:border-gray-700">
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Background</label>
                <div className="flex items-center gap-2">
                    <input
                        data-testid="settings-custom-bg"
                        type="color"
                        value={customTheme.bg}
                        onChange={(e) => setCustomTheme({ ...customTheme, bg: e.target.value })}
                        className="w-8 h-8 p-0 border-0 rounded cursor-pointer"
                    />
                    <span className="text-xs text-gray-600 dark:text-gray-400 font-mono">{customTheme.bg}</span>
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Text</label>
                <div className="flex items-center gap-2">
                    <input
                        data-testid="settings-custom-fg"
                        type="color"
                        value={customTheme.fg}
                        onChange={(e) => setCustomTheme({ ...customTheme, fg: e.target.value })}
                        className="w-8 h-8 p-0 border-0 rounded cursor-pointer"
                    />
                     <span className="text-xs text-gray-600 dark:text-gray-400 font-mono">{customTheme.fg}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Font Family */}
        <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Font Family</label>
            <select
                data-testid="settings-font-family"
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="w-full text-sm p-2 border rounded dark:bg-gray-700 dark:text-white dark:border-gray-600"
            >
                {fontOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>

        {/* Font Size */}
        <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Font Size: {fontSize}%</label>
            <div className="flex items-center gap-3">
                <button
                data-testid="settings-font-size-decrease"
                onClick={() => setFontSize(Math.max(50, fontSize - 10))}
                className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-medium"
                >
                    A-
                </button>
                <input
                data-testid="settings-font-size-range"
                type="range"
                min="50"
                max="200"
                step="10"
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value))}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                />
                <button
                data-testid="settings-font-size-increase"
                onClick={() => setFontSize(Math.min(200, fontSize + 10))}
                className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-medium"
                >
                    A+
                </button>
            </div>
        </div>

        {/* Line Height */}
        <div>
            <label className="block text-xs text-gray-500 mb-1">Line Height: {lineHeight}</label>
            <div className="flex items-center gap-3">
                <button
                    data-testid="settings-line-height-decrease"
                    onClick={() => setLineHeight(Math.max(1.0, Number((lineHeight - 0.1).toFixed(1))))}
                    className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-white"
                >
                    -
                </button>
                <input
                    data-testid="settings-line-height-range"
                    type="range"
                    min="1.0"
                    max="3.0"
                    step="0.1"
                    value={lineHeight}
                    onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                />
                <button
                    data-testid="settings-line-height-increase"
                    onClick={() => setLineHeight(Math.min(3.0, Number((lineHeight + 0.1).toFixed(1))))}
                    className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-white"
                >
                    +
                </button>
            </div>
        </div>

        <SettingsSectionHeader title="Audio" />

        {/* Voice Selection */}
        <div>
             <label className="block text-xs text-gray-500 mb-1">Voice</label>
             <select
                 data-testid="settings-voice-select"
                 className="w-full text-sm p-2 border rounded dark:bg-gray-700 dark:text-white dark:border-gray-600"
                 value={voice?.name || ''}
                 onChange={(e) => {
                     const selected = availableVoices.find(v => v.name === e.target.value);
                     setVoice(selected || null);
                 }}
             >
                 <option value="">Default</option>
                 {availableVoices.map(v => (
                     <option key={v.id} value={v.name}>{v.name.slice(0, 30)}...</option>
                 ))}
             </select>
        </div>

        {/* Speed */}
        <div>
            <label className="block text-xs text-gray-500 mb-1">Speed: {rate}x</label>
            <input
                data-testid="settings-speed-range"
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={rate}
                onChange={(e) => setRate(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
            />
        </div>

        <SettingsSectionHeader title="System" />

        <div className="space-y-2">
            <button
                data-testid="settings-clear-storage-button"
                onClick={handleClearStorage}
                className="w-full flex items-center justify-start gap-2 p-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
            >
                <Trash2 className="w-4 h-4" />
                Clear Book Progress
            </button>
            <button
                 data-testid="settings-reset-button"
                 onClick={handleResetSettings}
                 className="w-full flex items-center justify-start gap-2 p-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            >
                <X className="w-4 h-4" />
                Reset Display Settings
            </button>
        </div>

      </div>
    </div>
  );
};
