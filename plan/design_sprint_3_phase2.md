# Design Sprint 3 - Phase 2: The Audio Deck

## 1. Goal
Unify the playback experience. The user is in a "Listening Room" mental state. They should not have to leave the player controls to adjust the voice, speed, or text processing rules (sanitization).

## 2. Key Changes
*   **New Component:** `UnifiedAudioPanel.tsx`.
*   **Merge:** Combine `TTSQueue` (existing) and `TTSPanel` (settings) logic.
*   **Consolidation:** Move Sanitization settings here (as they affect the listening stream).
*   **UX Pattern:** A Side Panel with a persistent player header ("The Stage") and switchable content area ("Queue" vs "Settings").

## 3. Implementation Specification

### 3.1 Component Structure (`src/components/reader/UnifiedAudioPanel.tsx`)

This component will be a `SheetContent` (Side Drawer).

```tsx
export const UnifiedAudioPanel = () => {
  const { player, voice, queue, sanitization } = useTTSStore();
  const [view, setView] = useState<'queue' | 'settings'>('queue');

  return (
    <SheetContent side="right" className="w-full sm:w-[400px] flex flex-col p-0 gap-0">
      <SheetHeader className="p-4 border-b">
        <SheetTitle>Audio Deck</SheetTitle>
      </SheetHeader>

      {/* 1. The Stage (Always Visible Player) */}
      <div className="player-stage bg-muted/30 p-4 border-b">
         {/* Scrubber */}
         <div className="mb-4">
            <Slider
              value={[player.progress]}
              max={100}
              onValueChange={player.seekToPercent}
              className="mb-2"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
               <span>{formatTime(player.currentTime)}</span>
               <span>{formatTime(player.totalTime)}</span>
            </div>
         </div>

         {/* Main Controls */}
         <div className="flex justify-center items-center gap-6 mb-4">
            <Button variant="ghost" size="icon" onClick={player.seekBack} aria-label="Rewind 15s">
               <Rewind15Icon className="h-6 w-6" />
            </Button>
            <Button size="icon" className="h-12 w-12 rounded-full" onClick={player.togglePlay}>
               {player.isPlaying ? <PauseIcon /> : <PlayIcon />}
            </Button>
            <Button variant="ghost" size="icon" onClick={player.seekForward} aria-label="Forward 15s">
               <Forward15Icon className="h-6 w-6" />
            </Button>
         </div>

         {/* Quick Toggles / Status */}
         <div className="flex justify-center gap-4">
            <Badge variant="outline" className="cursor-pointer" onClick={() => setView('settings')}>
               {player.rate}x
            </Badge>
            <Badge variant="outline" className="cursor-pointer truncate max-w-[150px]" onClick={() => setView('settings')}>
               {voice.currentName || 'Select Voice'}
            </Badge>
         </div>
      </div>

      {/* 2. The Content Area (Switchable) */}
      <div className="flex-1 overflow-y-auto">
        {view === 'queue' ? (
          <div className="h-full">
             <TTSQueue /> {/* Existing component, ensure it fits the container */}
          </div>
        ) : (
          <div className="p-6 space-y-8">
             {/* Voice & Pace */}
             <section className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">Voice & Pace</h3>
                <div className="space-y-2">
                   <label className="text-sm">Speed ({player.rate}x)</label>
                   <Slider
                      value={[player.rate]}
                      min={0.5}
                      max={3.0}
                      step={0.1}
                      onValueChange={(val) => player.setRate(val[0])}
                   />
                </div>
                <div className="space-y-2">
                   <label className="text-sm">Voice</label>
                   <Select value={voice.currentId} onValueChange={voice.setVoice}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                         {/* Render voice options */}
                      </SelectContent>
                   </Select>
                </div>
             </section>

             {/* Flow Control */}
             <section className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">Flow Control</h3>
                <div className="flex items-center justify-between">
                   <label className="text-sm">Skip URLs & Citations</label>
                   <Switch checked={sanitization.enabled} onCheckedChange={sanitization.toggle} />
                </div>
                {/* Add Smart Resume Toggle if available in store */}
             </section>

             {/* Lexicon Link */}
             <section className="pt-4 border-t">
                 <Button variant="outline" className="w-full" onClick={actions.openLexiconModal}>
                    <MicIcon className="mr-2 h-4 w-4" />
                    Manage Pronunciation Rules
                 </Button>
             </section>
          </div>
        )}
      </div>

      {/* 3. Footer Toggle */}
      <div className="border-t p-2 grid grid-cols-2 gap-2 bg-background">
         <Button
            variant={view === 'queue' ? 'default' : 'ghost'}
            onClick={() => setView('queue')}
            size="sm"
         >
            Up Next
         </Button>
         <Button
            variant={view === 'settings' ? 'default' : 'ghost'}
            onClick={() => setView('settings')}
            size="sm"
         >
            Settings
         </Button>
      </div>
    </SheetContent>
  );
}
```

### 3.2 Integration Steps

1.  **Create Component:** Implement `UnifiedAudioPanel.tsx`.
2.  **Modify ReaderView:**
    *   Update the `Headphones` icon button to open this new panel.
    *   Remove the separate logic that opened `TTSPanel`.
3.  **Refactor Store:** Ensure `useTTSStore` provides access to sanitization and voice lists conveniently.
4.  **Verification:**
    *   Verify playback controls work.
    *   Verify switching between Queue and Settings views.
    *   Verify changing voice/speed applies immediately.
    *   Verify "Up Next" queue displays correctly.

## 4. Acceptance Criteria
*   Side panel combines Player and Settings.
*   User can toggle between Queue and Settings.
*   Sanitization options are present in the Settings view.
*   API Keys are **NOT** present (moved to System Engine).
