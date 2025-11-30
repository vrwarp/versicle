import { useEffect } from 'react';
import { useReaderStore } from '../store/useReaderStore';

/**
 * Synchronizes the reader theme with the document root class.
 * This ensures that Tailwind's dark mode and custom CSS variables work correctly.
 */
export const ThemeSynchronizer = () => {
  const { currentTheme } = useReaderStore();

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark', 'sepia');

    if (currentTheme === 'light') {
      root.classList.add('light');
    } else if (currentTheme === 'dark') {
      root.classList.add('dark');
    } else if (currentTheme === 'sepia') {
      root.classList.add('sepia');
    } else if (currentTheme === 'custom') {
        // For custom theme, we might need a way to inject variables or class
        // Current implementation of 'custom' in ReaderView just changes epub colors.
        // For UI, we might fallback to light or dark depending on brightness?
        // Let's assume light for now or handle 'custom' class if we define it.
        root.classList.add('light');
    }
  }, [currentTheme]);

  return null;
};
