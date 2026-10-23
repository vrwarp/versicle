import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFirestoreSync } from './useFirestoreSync';
import { useSyncStore } from '@store/useSyncStore';
import { getSyncOrchestratorAsync } from '@app/sync/createSync';

vi.mock('@app/sync/createSync', () => ({
    getSyncOrchestratorAsync: vi.fn(),
}));

describe('useFirestoreSync', () => {
    const initialState = useSyncStore.getState();

    beforeEach(() => {
        vi.mocked(getSyncOrchestratorAsync).mockReset();
        useSyncStore.setState({
            firebaseEnabled: true,
            firebaseConfig: {
                ...initialState.firebaseConfig,
                apiKey: 'key',
                authDomain: 'example.firebaseapp.com',
                projectId: 'project',
                appId: 'app',
            },
        });
    });

    afterEach(() => {
        useSyncStore.setState(initialState, true);
    });

    it('starts the orchestrator when Firebase is enabled and configured', async () => {
        const start = vi.fn().mockResolvedValue(undefined);
        vi.mocked(getSyncOrchestratorAsync).mockResolvedValue({ start } as never);

        const { result } = renderHook(() => useFirestoreSync());

        expect(result.current.isConfigured).toBe(true);
        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    });

    it('does not start the orchestrator when the config is incomplete', () => {
        useSyncStore.setState({
            firebaseConfig: { ...useSyncStore.getState().firebaseConfig, apiKey: '' },
        });

        const { result } = renderHook(() => useFirestoreSync());

        expect(result.current.isConfigured).toBe(false);
        expect(getSyncOrchestratorAsync).not.toHaveBeenCalled();
    });

    describe('regression: orchestrator start failure', () => {
        it('does not leak an unhandled rejection when the orchestrator fails to load', async () => {
            const onUnhandled = vi.fn();
            process.on('unhandledRejection', onUnhandled);
            try {
                vi.mocked(getSyncOrchestratorAsync).mockRejectedValue(new Error('chunk load failed'));

                renderHook(() => useFirestoreSync());
                await waitFor(() => expect(getSyncOrchestratorAsync).toHaveBeenCalled());
                // Let any dangling rejection surface.
                await new Promise((resolve) => setTimeout(resolve, 20));

                expect(onUnhandled).not.toHaveBeenCalled();
            } finally {
                process.off('unhandledRejection', onUnhandled);
            }
        });
    });
});
