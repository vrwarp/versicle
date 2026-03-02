import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { DataRecoveryView } from './DataRecoveryView';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

vi.mock('y-indexeddb', () => {
    return {
        IndexeddbPersistence: class {
            constructor() { }
            once(event: string, callback: () => void) {
                if (event === 'synced') {
                    // Simulate sync event after a short delay
                    setTimeout(callback, 50);
                }
            }
            destroy() { }
        }
    };
});

describe('DataRecoveryView', () => {
    it('renders the component with initial state', () => {
        render(<DataRecoveryView />);

        expect(screen.getByText('Raw Data Recovery')).toBeInTheDocument();
        expect(screen.getByText('Load Data')).toBeInTheDocument();
        expect(screen.getByText('Download JSON')).toBeDisabled();
    });

    it('loads data successfully', async () => {
        render(<DataRecoveryView />);

        fireEvent.click(screen.getByText('Load Data'));

        // Wait for the sync event to simulate finishing
        await waitFor(() => {
            expect(screen.getByText('Reload Data')).toBeInTheDocument();
        });

        // Download button should be enabled
        expect(screen.getByText('Download JSON')).not.toBeDisabled();
    });
});
