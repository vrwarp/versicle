import { create } from 'zustand';
import { yjs } from './middleware/yjs';
import { yDoc } from './yjs-provider';

interface ReaderSyncState {
  currentTheme: 'light' | 'dark' | 'sepia';
  customTheme: { bg: string; fg: string };
  fontFamily: string;
  lineHeight: number;
  fontSize: number;

  // Actions must be defined here but implemented via setState in the component/hook wrapper
  // OR we include them in the store and exclude them from sync in middleware (handled by typeof function check)
  setTheme: (theme: 'light' | 'dark' | 'sepia') => void;
  setCustomTheme: (theme: { bg: string; fg: string }) => void;
  setFontFamily: (font: string) => void;
  setLineHeight: (height: number) => void;
  setFontSize: (size: number) => void;
}

export const useReaderSyncStore = create<ReaderSyncState>()(
  yjs(
    yDoc,
    'settings',
    (set) => ({
      currentTheme: 'light',
      customTheme: { bg: '#ffffff', fg: '#000000' },
      fontFamily: 'serif',
      lineHeight: 1.5,
      fontSize: 100,

      setTheme: (theme) => set({ currentTheme: theme }),
      setCustomTheme: (customTheme) => set({ customTheme }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
      setFontSize: (size) => set({ fontSize: size }),
    })
  )
);
