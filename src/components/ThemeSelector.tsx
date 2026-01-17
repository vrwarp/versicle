import { cn } from "../lib/utils";

interface ThemeSelectorProps {
  currentTheme: 'light' | 'dark' | 'sepia' | 'custom';
  onThemeChange: (theme: 'light' | 'dark' | 'sepia' | 'custom') => void;
  className?: string;
}

export const ThemeSelector = ({ currentTheme, onThemeChange, className }: ThemeSelectorProps) => {
  return (
    <div className={cn("flex gap-2 w-full", className)}>
      <button
        onClick={() => onThemeChange('light')}
        className={cn(
          "flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-all",
          "bg-white text-black border-gray-200 hover:bg-gray-50",
          currentTheme === 'light' && "ring-2 ring-primary ring-offset-2 border-transparent"
        )}
        aria-label="Select Light theme"
      >
        White
      </button>

      <button
        onClick={() => onThemeChange('sepia')}
        className={cn(
          "flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-all",
          "bg-[#F5E6D3] text-[#5C4B37] border-transparent hover:bg-[#EBDCC9]",
          currentTheme === 'sepia' && "ring-2 ring-primary ring-offset-2"
        )}
        aria-label="Select Sepia theme"
      >
        Sepia
      </button>

      <button
        onClick={() => onThemeChange('dark')}
        className={cn(
          "flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-all",
          "bg-[#1a1a1a] text-white border-transparent hover:bg-[#2a2a2a]",
          currentTheme === 'dark' && "ring-2 ring-primary ring-offset-2"
        )}
        aria-label="Select Dark theme"
      >
        Dark
      </button>
    </div>
  );
};
