import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
