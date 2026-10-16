import { useEffect } from 'react';
import { usePreferencesStore } from '@store/usePreferencesStore';

/**
 * Synchronizes the reader theme with the document root class.
 * This ensures that Tailwind's dark mode and custom CSS variables work correctly.
 */
export const ThemeSynchronizer = () => {
  const currentTheme = usePreferencesStore(state => state.currentTheme) || 'light';

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
      // 'custom' only recolors the EPUB content (see epubTheming.ts in the
      // reader engine); the app chrome falls back to the light theme.
      root.classList.add('light');
    }
  }, [currentTheme]);

  return null;
};
