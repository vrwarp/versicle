import React from 'react';
import { useReaderStore } from '../../store/useReaderStore';
import { X } from 'lucide-react';

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
    setLineHeight
  } = useReaderStore();

  const fontOptions = [
    { label: 'Serif', value: 'Merriweather, Georgia, serif' },
    { label: 'Sans-Serif', value: 'Roboto, Helvetica, Arial, sans-serif' },
    { label: 'Monospace', value: 'Consolas, Monaco, monospace' },
    { label: 'Dyslexic', value: 'OpenDyslexic, sans-serif' }, // Assuming it might be available or fallback
  ];

  return (
    <div className="absolute top-14 right-4 w-72 bg-white dark:bg-gray-800 shadow-xl rounded-lg border border-gray-200 dark:border-gray-700 z-30 flex flex-col max-h-[80vh] overflow-y-auto">
      <div className="flex justify-between items-center p-4 border-b border-gray-100 dark:border-gray-700">
        <h3 className="text-sm font-bold dark:text-white">Reader Settings</h3>
        <button onClick={onClose} aria-label="Close Settings">
          <X className="w-4 h-4 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300" />
        </button>
      </div>

      <div className="p-4 space-y-6">
        {/* Theme Selection */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase">Theme</label>
          <div className="flex gap-2 mb-3">
            {(['light', 'dark', 'sepia', 'custom'] as const).map((theme) => (
              <button
                key={theme}
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

        {/* Typography */}
        <div>
           <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase">Typography</label>

           {/* Font Family */}
           <div className="mb-3">
               <label className="block text-xs text-gray-500 mb-1">Font Family</label>
               <select
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
                    onClick={() => setFontSize(Math.max(50, fontSize - 10))}
                    className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-medium"
                  >
                      A-
                  </button>
                  <input
                    type="range"
                    min="50"
                    max="200"
                    step="10"
                    value={fontSize}
                    onChange={(e) => setFontSize(parseInt(e.target.value))}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                  />
                  <button
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
                     onClick={() => setLineHeight(Math.max(1.0, Number((lineHeight - 0.1).toFixed(1))))}
                     className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-white"
                   >
                     -
                   </button>
                    <input
                        type="range"
                        min="1.0"
                        max="3.0"
                        step="0.1"
                        value={lineHeight}
                        onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                    <button
                     onClick={() => setLineHeight(Math.min(3.0, Number((lineHeight + 0.1).toFixed(1))))}
                     className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-white"
                   >
                     +
                   </button>
               </div>
           </div>
        </div>
      </div>
    </div>
  );
};
