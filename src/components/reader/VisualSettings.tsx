import { useReaderStore } from "../../store/useReaderStore"
import { PopoverContent, PopoverClose } from "../ui/Popover"
import { Button } from "../ui/Button"
import { Slider } from "../ui/Slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/Select"
import { Tabs, TabsList, TabsTrigger } from "../ui/Tabs"
import { Label } from "../ui/Label"
import { Switch } from "../ui/Switch"
import { cn } from "../../lib/utils"
import { X } from "lucide-react"

interface ThemeSwatchProps {
  mode: 'light' | 'dark' | 'sepia'
  active: boolean
  onClick: () => void
}

const ThemeSwatch = ({ mode, active, onClick }: ThemeSwatchProps) => {
  const bg = mode === 'light' ? 'bg-white' : mode === 'dark' ? 'bg-neutral-900' : 'bg-[#f4ecd8]'
  const border = active ? 'ring-2 ring-primary ring-offset-2' : 'border border-input'

  return (
    <button
      className={cn("w-10 h-10 rounded-full", bg, border)}
      onClick={onClick}
      aria-label={`Select ${mode} theme`}
    />
  )
}

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
    viewMode, setViewMode,
    lineHeight, setLineHeight,
    shouldForceFont, setShouldForceFont
  } = useReaderStore();

  return (
    <PopoverContent className="w-80 p-4 relative">
      <PopoverClose className="absolute right-2 top-2 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground" asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </Button>
      </PopoverClose>

      {/* 1. The "Ambience" Row (Themes) */}
      <div className="section-theme mb-6">
        <Label className="mb-2 block">Ambience</Label>
        <div className="flex gap-4">
           <ThemeSwatch mode="light" active={currentTheme === 'light'} onClick={() => setTheme('light')} />
           <ThemeSwatch mode="sepia" active={currentTheme === 'sepia'} onClick={() => setTheme('sepia')} />
           <ThemeSwatch mode="dark"  active={currentTheme === 'dark'}  onClick={() => setTheme('dark')} />
        </div>
      </div>

      {/* 2. The "Legibility" Row (Size & Font) */}
      <div className="section-type mb-6">
        <Label className="mb-2 block">Legibility</Label>
        <div className="flex items-center gap-2 mb-3">
           <Button variant="ghost" size="sm" onClick={() => setFontSize(Math.max(12, fontSize - 10))} aria-label="Decrease font size">
             <span className="text-sm">A</span>
           </Button>
           <Slider
              value={[fontSize]}
              min={50}
              max={200}
              step={10}
              onValueChange={(val) => setFontSize(val[0])}
              className="flex-1"
           />
           <Button variant="ghost" size="sm" onClick={() => setFontSize(Math.min(200, fontSize + 10))} aria-label="Increase font size">
             <span className="text-lg">A</span>
           </Button>
        </div>
        <Select value={fontFamily} onValueChange={setFontFamily}>
           <SelectTrigger>
             <SelectValue placeholder="Font Family" />
           </SelectTrigger>
           <SelectContent>
             <SelectItem value="serif">Serif</SelectItem>
             <SelectItem value="sans-serif">Sans-Serif</SelectItem>
             <SelectItem value="monospace">Monospace</SelectItem>
           </SelectContent>
        </Select>
        <div className="flex items-center justify-between mt-3">
          <Label htmlFor="force-font-switch" className="text-sm">Force Theme</Label>
          <Switch
            id="force-font-switch"
            checked={shouldForceFont}
            onCheckedChange={setShouldForceFont}
          />
        </div>
      </div>

      {/* 3. The "Format" Row (Layout) */}
      <div className="section-layout">
         <Label className="mb-2 block">Layout</Label>
         <Tabs value={viewMode} onValueChange={(val) => setViewMode(val as 'paginated' | 'scrolled')} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="paginated">Paginated</TabsTrigger>
              <TabsTrigger value="scrolled">Scrolled</TabsTrigger>
            </TabsList>
         </Tabs>

         <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Line Height</span>
            <div className="flex items-center gap-2">
               <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setLineHeight(Math.max(1, parseFloat((lineHeight - 0.1).toFixed(1))))}>-</Button>
               <span className="w-8 text-center text-sm">{lineHeight.toFixed(1)}</span>
               <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setLineHeight(Math.min(3, parseFloat((lineHeight + 0.1).toFixed(1))))}>+</Button>
            </div>
         </div>
      </div>
    </PopoverContent>
  );
}
