# Design Sprint 3 - Phase 4: Integration & Cleanup

## 1. Goal
Wire all the new "rooms" together, ensure consistent navigation, and remove the obsolete "developer-centric" components.

## 2. Key Changes
*   **Header Redesign:** Update `ReaderView` header to strictly follow the `Aa` (Visual), `Headphones` (Audio), `Gear` (System) pattern.
*   **Lexicon Hook:** Implement the "Speak / Fix" context menu action.
*   **Cleanup:** Delete `ReaderSettings.tsx`, `TTSPanel.tsx`, and `TTSAbbreviationSettings.tsx`.

## 3. Implementation Specification

### 3.1 ReaderView Header Logic

Refactor the `ReaderView` top bar to use a unified state for panels.

```tsx
// ReaderView.tsx
const [activePanel, setActivePanel] = useState<'audio' | null>(null); // Only Audio is a panel
const [visualOpen, setVisualOpen] = useState(false); // Popover state
const [systemOpen, setSystemOpen] = useState(false); // Modal state

return (
  <>
    <Header>
       {/* ... */}
       <div className="actions">
          {/* Visual - Popover Trigger */}
          <Popover open={visualOpen} onOpenChange={setVisualOpen}>
             <PopoverTrigger asChild>
                <Button icon="Aa" />
             </PopoverTrigger>
             <VisualSettings />
          </Popover>

          {/* Audio - Side Panel Trigger */}
          <Button icon="Headphones" onClick={() => setActivePanel(activePanel === 'audio' ? null : 'audio')} />

          {/* System - Modal Trigger */}
          <Button icon="Gear" onClick={() => setSystemOpen(true)} />
       </div>
    </Header>

    <UnifiedAudioPanel open={activePanel === 'audio'} onClose={() => setActivePanel(null)} />
    <GlobalSettingsDialog open={systemOpen} onOpenChange={setSystemOpen} />
  </>
)
```

### 3.2 Contextual Lexicon Hook

Enhance the text selection behavior in `ReaderView`.

*   **Current:** `epub.js` `selected` event -> Opens standard browser menu or custom highlight menu.
*   **New:** Intercept selection. Show a custom Popover/Menu near the selection with options:
    *   Highlight (Colors)
    *   "Fix Pronunciation" -> Opens `LexiconManager` modal with selected text pre-filled.

### 3.3 Deletion & cleanup

Once verified, remove the following files:
*   `src/components/reader/ReaderSettings.tsx`
*   `src/components/reader/TTSPanel.tsx`
*   `src/components/reader/TTSAbbreviationSettings.tsx`
*   Any unused UI components specific to the old layouts.

## 4. Acceptance Criteria
*   The "Three Rooms" navigation is fully functional.
*   No duplicate settings exist (e.g., Font settings only in Visual, not System).
*   Old components are deleted.
*   Codebase is cleaner and grouped by user intent.
*   All tests pass.
