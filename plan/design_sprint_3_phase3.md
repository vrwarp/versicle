# Design Sprint 3 - Phase 3: The System Engine

## 1. Goal
Create a centralized "Engine Room" for global configuration. These are "set and forget" settings (API keys, gestures, abbreviations) that clutter the daily reading interface.

## 2. Key Changes
*   **New Component:** `GlobalSettingsDialog.tsx`.
*   **Location:** Modal Dialog (not a side panel).
*   **Access:** Triggered by a 'Gear' icon in the main navigation (Library and Reader).
*   **Content:** General (Gestures), TTS Engine (Keys, Provider), Dictionary (Abbreviations).

## 3. Implementation Specification

### 3.1 Component Structure (`src/components/ui/GlobalSettingsDialog.tsx`)

A Modal with a sidebar layout (Tabs on left, content on right).

```tsx
export const GlobalSettingsDialog = ({ open, onOpenChange }) => {
  const [activeTab, setActiveTab] = useState('general');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[600px] flex p-0 overflow-hidden">

        {/* Sidebar Navigation */}
        <div className="w-1/4 bg-muted/30 border-r p-4 space-y-2">
           <h2 className="text-lg font-semibold mb-4 px-2">Settings</h2>
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
                         <div className="font-medium">Gesture Mode</div>
                         <div className="text-sm text-muted-foreground">Swipe to turn pages</div>
                      </div>
                      <Switch checked={gestures.enabled} onCheckedChange={gestures.toggle} />
                   </div>
                   <div className="flex items-center justify-between py-2 border-b">
                      <div>
                         <div className="font-medium">Immersive Mode</div>
                         <div className="text-sm text-muted-foreground">Hide UI automatically while reading</div>
                      </div>
                      <Switch checked={immersive.enabled} onCheckedChange={immersive.toggle} />
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
                         <Select value={tts.provider} onValueChange={tts.setProvider}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="google">Google Cloud TTS</SelectItem>
                               <SelectItem value="openai">OpenAI</SelectItem>
                               <SelectItem value="local">Web Speech (Local)</SelectItem>
                            </SelectContent>
                         </Select>
                      </div>

                      {/* Render inputs based on provider */}
                      {tts.provider === 'google' && (
                         <div className="space-y-2">
                            <label className="text-sm font-medium">Google API Key</label>
                            <Input type="password" value={tts.googleKey} onChange={...} />
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
                {/* Embed existing AbbreviationManager logic here */}
                <AbbreviationManager />
             </div>
           )}

           {/* Tab: Data */}
           {activeTab === 'data' && (
             <div className="space-y-4">
                <h3 className="text-lg font-medium text-destructive">Danger Zone</h3>
                <Button variant="destructive" onClick={handleClearAllData}>
                   Clear All Data
                </Button>
             </div>
           )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### 3.2 Integration Steps

1.  **Create Component:** Implement `GlobalSettingsDialog.tsx`.
2.  **Mounting:** This dialog likely needs to be mounted at the `App` level or in a Layout component so it's accessible from both `LibraryView` and `ReaderView`.
3.  **State Management:** Create a global store slice (or use a local state lifted to context) to control the `isOpen` state of this dialog.
4.  **Triggers:**
    *   Add a Gear icon to the Library header.
    *   Add a Gear icon to the Reader header (Top Right).
5.  **Migration:** Move logic from `TTSAbbreviationSettings`, `TTSPanel` (keys), and `ReaderSettings` (gestures) into this dialog.

## 4. Acceptance Criteria
*   Modal opens from both Library and Reader.
*   API Keys are securely editable here.
*   Gestures can be toggled.
*   Abbreviations can be managed.
*   UI is distinct from the reading/listening controls.
