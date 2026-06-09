import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSyncToasts } from './useSyncToasts';
import { useReadingStateStore } from '../../../store/useReadingStateStore';
import { useToastStore } from '../../../store/useToastStore';
import { useBookStore } from '../../../store/useLibraryStore';

vi.mock('../../device-id', () => ({
    getDeviceId: () => 'local-device',
}));

describe('useSyncToasts predictability', () => {
    beforeEach(() => {
        useReadingStateStore.setState({ progress: {} });
        useToastStore.setState({ showToast: vi.fn() });
        useBookStore.setState({ books: {} });
    });

    it('should not stringify the entire progress on every update', () => {
        const spyStringify = vi.spyOn(JSON, 'stringify');
        renderHook(() => useSyncToasts());

        useReadingStateStore.setState({
            progress: {
                'book1': {
                    'local-device': { percentage: 0.1, lastRead: 100 }
                }
            }
        });

        expect(spyStringify).not.toHaveBeenCalled();
    });
});
