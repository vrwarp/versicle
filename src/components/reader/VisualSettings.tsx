import { usePreferencesStore } from "../../store/usePreferencesStore"
import { useBookStore } from "../../store/useBookStore"
import { useReaderUIStore } from "../../store/useReaderUIStore"
import { useShallow } from 'zustand/react/shallow';
import { PopoverContent, PopoverClose } from "../ui/Popover"
import { Button } from "../ui/Button"
import { Slider } from "../ui/Slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/Select"
import { Tabs, TabsList, TabsTrigger } from "../ui/Tabs"
import { Label } from "../ui/Label"
import { Switch } from "../ui/Switch"
import { X, Minus, Plus } from "lucide-react"
import { ThemeSelector } from "../ThemeSelector";

/**
 * Visual settings popover content.
 * Controls theme, font size, font family, line height, view mode (paginated/scrolled), and forced styling.
 *
 * @returns The VisualSettings component.
 */
export const VisualSettings = () => {
  const {
    currentTheme, setTheme,
    fontSize, setFontSize,
    fontFamily, setFontFamily,
    lineHeight, setLineHeight,
    shouldForceFont, setShouldForceFont,
    readerViewMode, setReaderViewMode,
    forceTraditionalChinese, setForceTraditionalChinese,
    showPinyin, setShowPinyin,
    pinyinSize, setPinyinSize
  } = usePreferencesStore(useShallow(state => ({
    currentTheme: state.currentTheme,
    setTheme: state.setTheme,
    fontSize: state.fontSize,
    setFontSize: state.setFontSize,
    fontFamily: state.fontFamily,
    setFontFamily: state.setFontFamily,
    lineHeight: state.lineHeight,
    setLineHeight: state.setLineHeight,
    shouldForceFont: state.shouldForceFont,
    setShouldForceFont: state.setShouldForceFont,
    readerViewMode: state.readerViewMode || 'paginated',
    setReaderViewMode: state.setReaderViewMode,
    forceTraditionalChinese: state.forceTraditionalChinese,
    setForceTraditionalChinese: state.setForceTraditionalChinese,
    showPinyin: state.showPinyin,
    setShowPinyin: state.setShowPinyin,
    pinyinSize: state.pinyinSize,
    setPinyinSize: state.setPinyinSize
  })));

  const activeBookId = useReaderUIStore(state => state.activeBookId);
  const currentBook = useBookStore(state => activeBookId ? state.books[activeBookId] : undefined);
  const updateBook = useBookStore(state => state.updateBook);
  const bookLang = currentBook?.language || 'en';

  return (
    <PopoverContent className="w-80 p-5 relative" onOpenAutoFocus={(e) => e.preventDefault()}>
      <PopoverClose className="absolute right-2 top-2 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground" asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6" data-testid="visual-settings-close-button" aria-label="Close visual settings">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </Button>
      </PopoverClose>


      {/* Book Language Override */}
      <div className="mb-6 space-y-3">
        <Label className="text-sm font-medium">Book Language</Label>
        <Select value={bookLang} onValueChange={(val) => activeBookId && updateBook(activeBookId, { language: val })}>
          <SelectTrigger data-testid="book-language-select">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English (en)</SelectItem>
            <SelectItem value="zh">Chinese (zh)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {bookLang === 'zh' && (
        <div className="mb-6 space-y-4 rounded-md bg-accent/50 p-3">
          <Label className="block text-sm font-medium text-foreground">Chinese Reading</Label>

          <div className="flex items-center justify-between">
            <Label htmlFor="force-traditional" className="text-sm cursor-pointer">Force Traditional Characters</Label>
            <Switch
              id="force-traditional"
              checked={forceTraditionalChinese}
              onCheckedChange={setForceTraditionalChinese}
              data-testid="force-traditional-switch"
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="show-pinyin" className="text-sm cursor-pointer">Show Pinyin</Label>
            <Switch
              id="show-pinyin"
              checked={showPinyin}
              onCheckedChange={setShowPinyin}
              data-testid="show-pinyin-switch"
            />
          </div>

          {showPinyin && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">Pinyin Size</Label>
                <span className="text-xs text-muted-foreground w-12 text-right">{pinyinSize}%</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-6 w-6 rounded-full" onClick={() => setPinyinSize(Math.max(50, pinyinSize - 10))}>
                  <Minus className="h-3 w-3" />
                </Button>
                <Slider
                  min={50}
                  max={150}
                  step={10}
                  value={[pinyinSize]}
                  onValueChange={([val]) => setPinyinSize(val)}
                  className="flex-1"
                />
                <Button variant="outline" size="icon" className="h-6 w-6 rounded-full" onClick={() => setPinyinSize(Math.min(150, pinyinSize + 10))}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 1. The "Ambience" Row (Themes) */}
      <div className="mb-6">
        <Label className="mb-3 block text-sm font-medium">Ambience</Label>
        <ThemeSelector currentTheme={currentTheme} onThemeChange={setTheme} />
      </div>

      {/* 2. The "Legibility" Row (Size & Font) */}
      <div className="mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Legibility</Label>
          <span className="text-xs text-muted-foreground font-mono" role="status" aria-live="polite">{fontSize}%</span>
        </div>

        {/* Font Size Slider Row */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setFontSize(Math.max(50, fontSize - 10))} className="h-8 w-8 p-0" aria-label="Decrease font size">
            <span className="text-xs font-medium">A</span>
          </Button>
          <Slider
            value={[fontSize]}
            min={50}
            max={200}
            step={10}
            onValueChange={(val) => setFontSize(val[0])}
            className="flex-1"
            aria-label="Font size percentage"
          />
          <Button variant="ghost" size="sm" onClick={() => setFontSize(Math.min(200, fontSize + 10))} className="h-8 w-8 p-0" aria-label="Increase font size">
            <span className="text-xl font-medium">A</span>
          </Button>
        </div>

        {/* Font Family Select */}
        <Select value={fontFamily} onValueChange={setFontFamily}>
          <SelectTrigger className="w-full" aria-label="Select Font Family">
            <SelectValue placeholder="Font Family" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="serif">Serif</SelectItem>
            <SelectItem value="sans-serif">Sans-Serif</SelectItem>
            <SelectItem value="monospace">Monospace</SelectItem>
          </SelectContent>
        </Select>

        {/* Force Theme Switch */}
        <div className="flex items-center justify-between">
          <Label htmlFor="force-font-switch" className="text-sm font-normal">Force Theme</Label>
          <Switch
            id="force-font-switch"
            checked={shouldForceFont}
            onCheckedChange={setShouldForceFont}
          />
        </div>
      </div>

      {/* 3. The "Format" Row (Layout) */}
      <div className="space-y-4">
        <Label className="block text-sm font-medium">Layout</Label>
        <Tabs value={readerViewMode} onValueChange={(val) => setReaderViewMode(val as 'paginated' | 'scrolled')} className="w-full">
          <TabsList className="grid w-full grid-cols-2" aria-label="Layout mode">
            <TabsTrigger value="paginated">Paginated</TabsTrigger>
            <TabsTrigger value="scrolled">Scrolled</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center justify-between pt-1">
          <span className="text-sm text-muted-foreground">Line Height</span>
          <div className="flex items-center gap-3 bg-secondary/50 rounded-md p-1">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setLineHeight(Math.max(1, parseFloat((lineHeight - 0.1).toFixed(1))))} aria-label="Decrease line height">
              <Minus className="h-3 w-3" />
            </Button>
            <span className="w-8 text-center text-sm font-medium tabular-nums" role="status" aria-live="polite">{(lineHeight || 1.5).toFixed(1)}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setLineHeight(Math.min(3, parseFloat((lineHeight + 0.1).toFixed(1))))} aria-label="Increase line height">
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </PopoverContent>
  );
}
