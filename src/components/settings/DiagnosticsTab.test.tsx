/**
 * DiagnosticsTab reads the ENGINE-side flight recorder over the command facade
 * (5b-PR4, the S9 fix): the live buffer/stats come from the worker through the
 * engine handle, never from the main-thread module singleton (which sees no
 * engine traffic). Per the useAudioCommands contract, component tests mock the
 * facade module itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DiagnosticsTab } from './DiagnosticsTab';
import { useAudioCommands } from '@app/tts/useAudioCommands';

vi.mock('@app/tts/useAudioCommands', () => ({
    useAudioCommands: vi.fn(),
}));

function makeCommands() {
    return {
        exportDiagnostics: vi.fn().mockResolvedValue({
            stats: { eventCount: 42, capacity: 2000, oldestWall: 1700000000000 },
            events: [],
        }),
        triggerDiagnosticsSnapshot: vi.fn().mockResolvedValue('snap-1'),
        listDiagnosticSnapshots: vi.fn().mockResolvedValue([
            {
                id: 'snap-1',
                createdAt: 1700000001000,
                trigger: 'anomaly:chapter_advance',
                note: 'Auto-detected premature chapter advance at 40%',
                context: { bookId: 'book-1', sectionIndex: 2, currentIndex: 5, queueLength: 40, status: 'playing' },
                eventCount: 1234,
                timeRange: { first: 1, last: 2 },
                sizeBytes: 2048,
            },
        ]),
        deleteDiagnosticSnapshot: vi.fn().mockResolvedValue(undefined),
        clearDiagnosticSnapshots: vi.fn().mockResolvedValue(undefined),
        shareDiagnosticSnapshot: vi.fn().mockResolvedValue(undefined),
    };
}

describe('DiagnosticsTab (worker data via the engine handle)', () => {
    let commands: ReturnType<typeof makeCommands>;

    beforeEach(() => {
        commands = makeCommands();
        vi.mocked(useAudioCommands).mockReturnValue(commands as never);
    });

    it('renders the ENGINE buffer stats from exportDiagnostics (not a local singleton)', async () => {
        render(<DiagnosticsTab />);

        await waitFor(() => {
            expect(screen.getByText(/42 \/ 2000 events tracked/)).toBeTruthy();
        });
        expect(commands.exportDiagnostics).toHaveBeenCalled();
        expect(commands.listDiagnosticSnapshots).toHaveBeenCalled();
    });

    it('lists persisted snapshots with their anomaly badge', async () => {
        render(<DiagnosticsTab />);

        await waitFor(() => {
            expect(screen.getByText('ANOMALY')).toBeTruthy();
        });
        expect(screen.getByText(/premature chapter advance/)).toBeTruthy();
    });

    it('captures a manual snapshot through the engine handle and refreshes', async () => {
        render(<DiagnosticsTab />);
        await waitFor(() => expect(commands.exportDiagnostics).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: /Capture Snapshot/i }));

        await waitFor(() => {
            expect(commands.triggerDiagnosticsSnapshot).toHaveBeenCalledWith('manual', 'User triggered snapshot');
        });
        // Refreshed after capture: export + list called again.
        expect(commands.exportDiagnostics.mock.calls.length).toBeGreaterThan(1);
    });

    it('shares and deletes snapshots through the facade', async () => {
        render(<DiagnosticsTab />);
        await waitFor(() => expect(screen.getByText('ANOMALY')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: /Share or Export JSON/i }));
        await waitFor(() => expect(commands.shareDiagnosticSnapshot).toHaveBeenCalledWith('snap-1'));

        fireEvent.click(screen.getByRole('button', { name: /Delete Snapshot/i }));
        await waitFor(() => expect(commands.deleteDiagnosticSnapshot).toHaveBeenCalledWith('snap-1'));
    });
});
