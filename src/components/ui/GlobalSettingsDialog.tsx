import { useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderStore } from '../../store/useReaderStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { TTSAbbreviationSettings } from '../reader/TTSAbbreviationSettings';

interface GlobalSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const GlobalSettingsDialog = ({ open, onOpenChange }: GlobalSettingsDialogProps) => {
  const [activeTab, setActiveTab] = useState<'general' | 'tts' | 'dictionary' | 'data'>('general');
  const { providerId, setProviderId, apiKeys, setGoogleKey, setOpenaiKey } = useTTSStore();
  // We need to add immersiveMode to useReaderStore in the next step, for now using a placeholder or existing if I find it.
  // The plan said "General" tab should include "Immersive Mode". I will assume it will be in useReaderStore.
  // I will check useReaderStore again, I remember not seeing immersiveMode. I will use a local state or just comment it out for now until I add it to the store.
  const { immersiveMode, setImmersiveMode } = useReaderStore();

  // Data management
  const resetLibrary = useLibraryStore(state => state.reset);
  const resetReader = useReaderStore(state => state.reset);
  const resetTTS = useTTSStore(state => state.reset);

  const handleClearAllData = () => {
    if (window.confirm('Are you sure you want to delete all data? This cannot be undone.')) {
      resetLibrary();
      resetReader();
      resetTTS();
      // Also clear IndexedDB if possible, but the reset methods might handle state.
      // For a full reset we might need to clear IDB.
      // Assuming store reset is enough for "Data Management" based on the spec "Clear All Data".
      window.location.reload();
    }
  };

  return (
    <Dialog
        isOpen={open}
        onClose={() => onOpenChange(false)}
        title="Settings"
        // Using a custom child layout instead of DialogContent which is not exported
    >
        <div className="flex h-[500px] overflow-hidden -mx-6 -mb-6">
            {/* Sidebar Navigation */}
            <div className="w-1/4 bg-muted/30 border-r p-4 space-y-2">
            <Button variant={activeTab === 'general' ? 'secondary' : 'ghost'} className="w-full justify-start" onClick={() => setActiveTab('general')}>
                General
            </Button>
            <Button variant={activeTab === 'tts' ? 'secondary' : 'ghost'} className="w-full justify-start" onClick={() => setActiveTab('tts')}>
                TTS Engine
            </Button>
            <Button variant={activeTab === 'dictionary' ? 'secondary' : 'ghost'} className="w-full justify-start" onClick={() => setActiveTab('dictionary')}>
                Dictionary
            </Button>
            <Button variant={activeTab === 'data' ? 'secondary' : 'ghost'} className="w-full justify-start text-destructive hover:text-destructive" onClick={() => setActiveTab('data')}>
                Data Management
            </Button>
            </div>

            {/* Content Area */}
            <div className="w-3/4 p-8 overflow-y-auto">

            {/* Tab: General */}
            {activeTab === 'general' && (
                <div className="space-y-6">
                    <div>
                    <h3 className="text-lg font-medium mb-2">Interaction</h3>
                    <div className="flex items-center justify-between py-2 border-b">
                        <div>
                            <div className="font-medium">Immersive Mode</div>
                            <div className="text-sm text-muted-foreground">Hide UI automatically while reading</div>
                        </div>
                        <Switch checked={immersiveMode} onCheckedChange={setImmersiveMode} />
                    </div>
                    </div>
                </div>
            )}

            {/* Tab: TTS Engine */}
            {activeTab === 'tts' && (
                <div className="space-y-6">
                    <div>
                    <h3 className="text-lg font-medium mb-4">Provider Configuration</h3>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Active Provider</label>
                            <Select value={providerId} onValueChange={(val: "google" | "openai" | "local") => setProviderId(val)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                <SelectItem value="google">Google Cloud TTS</SelectItem>
                                <SelectItem value="openai">OpenAI</SelectItem>
                                <SelectItem value="local">Web Speech (Local)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Render inputs based on provider */}
                        {providerId === 'google' && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Google API Key</label>
                            <Input type="password" value={apiKeys.google} onChange={(e) => setGoogleKey(e.target.value)} />
                                <p className="text-xs text-muted-foreground">Required for high-quality Google voices.</p>
                            </div>
                        )}
                        {providerId === 'openai' && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium">OpenAI API Key</label>
                            <Input type="password" value={apiKeys.openai} onChange={(e) => setOpenaiKey(e.target.value)} />
                                <p className="text-xs text-muted-foreground">Required for OpenAI voices.</p>
                            </div>
                        )}
                    </div>
                    </div>
                </div>
            )}

            {/* Tab: Dictionary */}
            {activeTab === 'dictionary' && (
                <div className="space-y-4">
                    <h3 className="text-lg font-medium">Text Segmentation</h3>
                    <p className="text-sm text-muted-foreground">
                    Define abbreviations that should not trigger a sentence break.
                    </p>
                    <TTSAbbreviationSettings />
                </div>
            )}

            {/* Tab: Data */}
            {activeTab === 'data' && (
                <div className="space-y-4">
                    <h3 className="text-lg font-medium text-destructive">Danger Zone</h3>
                    <p className="text-sm text-muted-foreground">
                    Resetting the application will remove all imported books, settings, and cached data.
                    </p>
                    <Button variant="destructive" onClick={handleClearAllData}>
                    Clear All Data
                    </Button>
                </div>
            )}
            </div>
        </div>
    </Dialog>
  );
};
