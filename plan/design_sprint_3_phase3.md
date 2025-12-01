# Design Sprint 3 - Phase 3: The System Engine

## 1. Goal
Centralize "Set and Forget" configurations. API Keys, detailed data management, and global rules belong in a dedicated "Engine Room" that doesn't clutter the daily reading or listening experience.

## 2. Key Changes
*   **New Component:** `GlobalSettingsDialog.tsx`.
*   **Location:** Modal Dialog (triggered by a Gear icon in the header).
*   **Structure:** Tabs for "General", "Dictionary", "Data", "TTS Engine".
*   **Migration:** Move API Key inputs, Abbreviation lists, and Data Clearing actions here.

## 3. Implementation Specification

### 3.1 Component Structure (`src/components/reader/GlobalSettingsDialog.tsx`)

This is a `Dialog` (Modal) component.

```tsx
export const GlobalSettingsDialog = ({ open, onOpenChange }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure global preferences and system behavior.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="dictionary">Dictionary</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
            <TabsTrigger value="engine">TTS Engine</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4 p-1">
             {/* Tab Content: General */}
             <TabsContent value="general">
                <div className="space-y-4">
                   {/* Theme System Override (if applicable) */}
                </div>
             </TabsContent>

             {/* Tab Content: Dictionary */}
             <TabsContent value="dictionary">
                {/* Embedded Lexicon / Abbreviation Manager */}
                {/* Note: Could embed the existing manager or link to it */}
                <TTSAbbreviationSettings />
             </TabsContent>

             {/* Tab Content: Data */}
             <TabsContent value="data">
                 <div className="space-y-4 border rounded p-4 border-destructive/50 bg-destructive/10">
                    <h4 className="font-medium text-destructive">Danger Zone</h4>
                    <p className="text-sm text-muted-foreground">
                       Clear all books, settings, and cached audio. This action cannot be undone.
                    </p>
                    <Button variant="destructive" onClick={handleReset}>
                       Reset Application
                    </Button>
                 </div>
             </TabsContent>

             {/* Tab Content: TTS Engine */}
             <TabsContent value="engine">
                {/* API Keys for Cloud Providers */}
                <div className="space-y-4">
                   <div className="space-y-2">
                      <Label>OpenAI API Key</Label>
                      <Input type="password" placeholder="sk-..." />
                   </div>
                   <div className="space-y-2">
                      <Label>Google Cloud Key</Label>
                      <Textarea placeholder="{ 'type': 'service_account' ... }" />
                   </div>
                </div>
             </TabsContent>
          </div>
        </Tabs>

        <DialogFooter>
           <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 3.2 Integration Steps

1.  **Create Component:** Implement `GlobalSettingsDialog.tsx`.
2.  **Modify Header:**
    *   Add a `Settings` (Gear) icon to the `ReaderView` header.
    *   Connect it to open this dialog.
3.  **Migrate Logic:**
    *   Move API Key storage/input logic from `TTSPanel` to the "TTS Engine" tab.
    *   Move "Clear Data" from any previous location to "Data".
    *   Move "Abbreviations" to "Dictionary".
4.  **Verification:**
    *   Verify API keys are saved and persistent.
    *   Verify Abbreviation settings are accessible.
    *   Verify "Reset Application" works as intended.

## 4. Acceptance Criteria
*   Modal dialog opens via Gear icon.
*   Tabs organize settings logically (General, Dictionary, Data, Engine).
*   API Keys can be entered and saved.
*   Application data can be reset.
*   Gesture mode toggle is present (even if placeholder logic for now).
