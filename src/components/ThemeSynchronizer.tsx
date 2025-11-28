import React, { useEffect } from 'react';
import { useReaderStore } from '../store/useReaderStore';

export const ThemeSynchronizer: React.FC = () => {
  const { currentTheme } = useReaderStore();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark', 'sepia');

    if (currentTheme === 'dark') {
      root.classList.add('dark');
    } else if (currentTheme === 'sepia') {
      root.classList.add('sepia');
    } else {
      root.classList.add('light');
    }
    // For 'custom', we currently default to light/default classes,
    // or we could inspect customTheme brightness to decide.
  }, [currentTheme]);

  return null;
};
