import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webContentLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
}

interface DriveState {
  isConnected: boolean;
  accessToken: string | null;
  tokenExpiration: number | null;
  folderId: string | null;
  files: DriveFile[];
  lastScanTime: number | null;
  isLoading: boolean;
  error: string | null;

  setAccessToken: (token: string, expiration?: number) => void;
  setFolderId: (id: string | null) => void;
  setFiles: (files: DriveFile[]) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  disconnect: () => void;
}

export const useDriveStore = create<DriveState>()(
  persist(
    (set) => ({
      isConnected: false,
      accessToken: null,
      tokenExpiration: null,
      folderId: null,
      files: [],
      lastScanTime: null,
      isLoading: false,
      error: null,

      setAccessToken: (token, expiration) => set({
        accessToken: token,
        tokenExpiration: expiration || (Date.now() + 3600 * 1000), // Default 1 hour
        isConnected: true,
        error: null
      }),

      setFolderId: (id) => set({ folderId: id }),

      setFiles: (files) => set({
        files,
        lastScanTime: Date.now(),
        isLoading: false,
        error: null
      }),

      setIsLoading: (loading) => set({ isLoading: loading }),

      setError: (error) => set({ error, isLoading: false }),

      disconnect: () => set({
        isConnected: false,
        accessToken: null,
        tokenExpiration: null,
        files: [],
        folderId: null,
        lastScanTime: null,
        error: null
      }),
    }),
    {
      name: 'drive-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        folderId: state.folderId,
        files: state.files,
        lastScanTime: state.lastScanTime
      }), // Only persist folderId and files
    }
  )
);
