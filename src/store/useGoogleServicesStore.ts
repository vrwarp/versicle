import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Google services UI state (Phase 7 §G).
 *
 * `connectedServices` is a "has connected before" HINT — it drives
 * reconnect-vs-first-connect copy only and is NEVER an authorization claim
 * (tokens are memory-only in GoogleAuthClient; after a reload the cache is
 * empty while this list still names the service). It is mirrored by the
 * GoogleAuthClient connect/disconnect hooks wired in
 * src/app/google/wireGoogle.ts; token FAILURES deliberately do not touch it
 * (the pre-Phase-7 force-disconnect-on-any-error is gone — GG-2).
 */
interface GoogleServicesState {
    connectedServices: string[];
    googleClientId: string | null;
    googleIosClientId: string | null;
    setGoogleClientId: (clientId: string) => void;
    setGoogleIosClientId: (clientId: string) => void;
    connectService: (serviceId: string) => void;
    disconnectService: (serviceId: string) => void;
    isServiceConnected: (serviceId: string) => boolean;
    reset: () => void;
}

export const useGoogleServicesStore = create<GoogleServicesState>()(
    persist(
        (set, get) => ({
            connectedServices: [],
            googleClientId: null,
            googleIosClientId: null,
            setGoogleClientId: (clientId) => set({ googleClientId: clientId }),
            setGoogleIosClientId: (clientId) => set({ googleIosClientId: clientId }),
            connectService: (serviceId) =>
                set((state) => ({
                    connectedServices: state.connectedServices.includes(serviceId)
                        ? state.connectedServices
                        : [...state.connectedServices, serviceId],
                })),
            disconnectService: (serviceId) =>
                set((state) => ({
                    connectedServices: state.connectedServices.filter((id) => id !== serviceId),
                })),
            isServiceConnected: (serviceId) => get().connectedServices.includes(serviceId),
            reset: () => set({ connectedServices: [] }),
        }),
        {
            name: 'google-services-storage',
        }
    )
);
