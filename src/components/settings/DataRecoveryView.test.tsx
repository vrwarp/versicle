import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import * as Y from 'yjs';
import { DataRecoveryView } from './DataRecoveryView';

// The view reads through the data layer's snapshot primitive since the
// P4-7/P9 retarget (no more temp IndexeddbPersistence dance); hand it a
// real encoded Y.Doc update.
const { readSnapshotMock } = vi.hoisted(() => ({ readSnapshotMock: vi.fn() }));
vi.mock('@data/snapshot/YjsSnapshotService', () => ({
    readSnapshot: readSnapshotMock,
}));

function encodedState(): Uint8Array {
    const doc = new Y.Doc();
    doc.getMap('library').set('book-1', 'Moby Dick');
    const update = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    return update;
}

describe('DataRecoveryView', () => {
    beforeEach(() => {
        readSnapshotMock.mockReset();
        readSnapshotMock.mockResolvedValue(encodedState());
    });

    it('renders the component with initial state', () => {
        render(<DataRecoveryView />);

        expect(screen.getByText('Raw Data Recovery')).toBeInTheDocument();
        expect(screen.getByText('Load Data')).toBeInTheDocument();
        expect(screen.getByText('Download JSON')).toBeDisabled();
    });

    it('loads data through the snapshot primitive and renders the extracted state', async () => {
        render(<DataRecoveryView />);

        fireEvent.click(screen.getByText('Load Data'));

        await waitFor(() => {
            expect(screen.getByText('Reload Data')).toBeInTheDocument();
        });

        expect(readSnapshotMock).toHaveBeenCalledTimes(1);
        // The decoded doc contents are shown raw.
        expect(screen.getByText(/Moby Dick/)).toBeInTheDocument();
        // Download button should be enabled
        expect(screen.getByText('Download JSON')).not.toBeDisabled();
    });

    it('surfaces an empty database as a read failure, not a silent success', async () => {
        readSnapshotMock.mockResolvedValue(null);
        render(<DataRecoveryView />);

        fireEvent.click(screen.getByText('Load Data'));

        await waitFor(() => {
            expect(screen.getByText('Failed to read database')).toBeInTheDocument();
        });
        expect(screen.getByText('Download JSON')).toBeDisabled();
    });
});
