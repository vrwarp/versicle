# Design Sprint 3 - Phase 1: The Visual Controller

## 1. Goal
Create a "Reading Room" experience where visual adjustments are transient and non-intrusive. The user should be able to tweak font, theme, and layout without losing context of the page.

## 2. Key Changes
*   **New Component:** `VisualSettings.tsx` (Popover).
*   **Removal:** Remove visual settings from the existing `ReaderSettings` side panel (eventually replacing it).
*   **UI Pattern:** Use a floating Popover anchored to the `Aa` button instead of a full-height side drawer.
*   **UX Improvement:** Hide hex codes; use visual swatches. Combine Font Size and Family into a dense "Legibility" row.

## 3. Implementation Specification

### 3.1 Component Structure (`src/components/reader/VisualSettings.tsx`)

The component should use the `Popover` primitive (or a new `Popover` component if needed) and interact directly with `useReaderStore`.

```tsx
export const VisualSettings = () => {
  const { theme, font, layout } = useReaderStore();

  return (
    <PopoverContent className="w-80 p-4">
      {/* 1. The "Ambience" Row (Themes) */}
      <div className="section-theme mb-6">
        <label className="text-sm font-medium mb-2 block">Ambience</label>
        <div className="flex gap-4">
           <ThemeSwatch mode="light" active={theme.current === 'light'} onClick={() => theme.setTheme('light')} />
           <ThemeSwatch mode="sepia" active={theme.current === 'sepia'} onClick={() => theme.setTheme('sepia')} />
           <ThemeSwatch mode="dark"  active={theme.current === 'dark'}  onClick={() => theme.setTheme('dark')} />
           {/* Custom theme logic can be simplified or hidden behind a 'more' for now */}
        </div>
      </div>

      {/* 2. The "Legibility" Row (Size & Font) */}
      <div className="section-type mb-6">
        <label className="text-sm font-medium mb-2 block">Legibility</label>
        <div className="flex items-center gap-2 mb-3">
           <Button variant="ghost" size="sm" onClick={font.decreaseFontSize} aria-label="Decrease font size">
             <span className="text-sm">A</span>
           </Button>
           <Slider
              value={[font.size]}
              min={12}
              max={32}
              step={1}
              onValueChange={(val) => font.setFontSize(val[0])}
              className="flex-1"
           />
           <Button variant="ghost" size="sm" onClick={font.increaseFontSize} aria-label="Increase font size">
             <span className="text-lg">A</span>
           </Button>
        </div>
        <Select value={font.family} onValueChange={font.setFontFamily}>
           <SelectTrigger>
             <SelectValue placeholder="Font Family" />
           </SelectTrigger>
           <SelectContent>
             <SelectItem value="serif">Serif</SelectItem>
             <SelectItem value="sans-serif">Sans-Serif</SelectItem>
             <SelectItem value="monospace">Monospace</SelectItem>
             {/* Add other supported fonts */}
           </SelectContent>
        </Select>
      </div>

      {/* 3. The "Format" Row (Layout) */}
      <div className="section-layout">
         <label className="text-sm font-medium mb-2 block">Layout</label>
         <Tabs value={layout.viewMode} onValueChange={layout.setViewMode} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="paginated">Paginated</TabsTrigger>
              <TabsTrigger value="scrolled">Scrolled</TabsTrigger>
            </TabsList>
         </Tabs>

         <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Line Height</span>
            <div className="flex items-center gap-2">
               <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => layout.setLineHeight(Math.max(1, layout.lineHeight - 0.1))}>-</Button>
               <span className="w-8 text-center text-sm">{layout.lineHeight.toFixed(1)}</span>
               <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => layout.setLineHeight(Math.min(3, layout.lineHeight + 0.1))}>+</Button>
            </div>
         </div>
      </div>
    </PopoverContent>
  );
}
```

### 3.2 Integration Steps

1.  **Create Component:** Implement `VisualSettings.tsx` using `shadcn/ui` components (`Popover`, `Slider`, `Select`, `Tabs`, `Button`).
2.  **Modify ReaderView:**
    *   Import `VisualSettings`.
    *   Change the `Aa` button trigger. Instead of opening the `ReaderSettings` sheet, it should trigger the `VisualSettings` popover.
3.  **Refactor Store (if needed):** Ensure `useReaderStore` exposes necessary setters cleanly.
4.  **Verification:**
    *   Verify theme switching works instantly.
    *   Verify font size adjustments update the reader.
    *   Verify layout switching (Paginated <-> Scrolled) works.

## 4. Acceptance Criteria
*   Clicking `Aa` opens the Popover.
*   The Popover contains Theme, Font, and Layout controls.
*   Changes apply immediately to the `ReaderView`.
*   The old "Display" section in `ReaderSettings` is no longer the primary way to access these settings (though we won't delete `ReaderSettings` until Phase 4).
