import { cn } from "../lib/utils";
import { Button } from "./ui/Button";

interface ThemeSelectorProps {
  currentTheme: 'light' | 'dark' | 'sepia';
  onThemeChange: (theme: 'light' | 'dark' | 'sepia') => void;
  className?: string;
}

export const ThemeSelector = ({ currentTheme, onThemeChange, className }: ThemeSelectorProps) => {
  return (
    <div className={cn("flex gap-2 w-full", className)}>
      <Button
        variant="ghost"
        onClick={() => onThemeChange('light')}
        className={cn(
          "flex-1 h-auto px-3 py-2 border transition-all",
          "bg-white text-black border-gray-200 hover:bg-gray-50",
          currentTheme === 'light' && "ring-2 ring-primary ring-offset-2 border-transparent"
        )}
        aria-label="Select Light theme"
        aria-pressed={currentTheme === 'light'}
      >
        White
      </Button>

      <Button
        variant="ghost"
        onClick={() => onThemeChange('sepia')}
        className={cn(
          "flex-1 h-auto px-3 py-2 border transition-all",
          "bg-[#F5E6D3] text-[#5C4B37] border-transparent hover:bg-[#EBDCC9]",
          currentTheme === 'sepia' && "ring-2 ring-primary ring-offset-2"
        )}
        aria-label="Select Sepia theme"
        aria-pressed={currentTheme === 'sepia'}
      >
        Sepia
      </Button>

      <Button
        variant="ghost"
        onClick={() => onThemeChange('dark')}
        className={cn(
          "flex-1 h-auto px-3 py-2 border transition-all",
          "bg-[#1a1a1a] text-white border-transparent hover:bg-[#2a2a2a]",
          currentTheme === 'dark' && "ring-2 ring-primary ring-offset-2"
        )}
        aria-label="Select Dark theme"
        aria-pressed={currentTheme === 'dark'}
      >
        Dark
      </Button>
    </div>
  );
};
