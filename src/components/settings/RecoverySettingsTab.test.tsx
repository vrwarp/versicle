import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RecoverySettingsTab, RecoverySettingsTabProps } from './RecoverySettingsTab';

describe('RecoverySettingsTab', () => {
    const defaultProps: RecoverySettingsTabProps = {
        checkpoints: [],
        recoveryStatus: null,
        onCreateCheckpoint: vi.fn()
    };

    it('renders disaster recovery header', () => {
        render(<RecoverySettingsTab {...defaultProps} />);

        expect(screen.getByText('Disaster Recovery')).toBeInTheDocument();
    });

    it('shows no checkpoints message when empty', () => {
        render(<RecoverySettingsTab {...defaultProps} />);

        expect(screen.getByText('No checkpoints available.')).toBeInTheDocument();
    });

    it('renders checkpoints when present', () => {
        const checkpoints = [
            // Using blobs as per new type
            { id: 1, timestamp: 1706900000000, trigger: 'manual', blob: new Uint8Array(), size: 10 },
            { id: 2, timestamp: 1706900100000, trigger: 'sync', blob: new Uint8Array(), size: 20 }
        ];
        render(<RecoverySettingsTab {...defaultProps} checkpoints={checkpoints} />);

        expect(screen.getByText('manual')).toBeInTheDocument();
        expect(screen.getByText('sync')).toBeInTheDocument();
        expect(screen.getAllByText('Inspect')).toHaveLength(2);
    });

    it('shows recovery status when present', () => {
        render(<RecoverySettingsTab {...defaultProps} recoveryStatus="Restoring..." />);

        expect(screen.getByText('Restoring...')).toBeInTheDocument();
    });

    it('calls onCreateCheckpoint when create button clicked', () => {
        const onCreateCheckpoint = vi.fn();
        render(
            <RecoverySettingsTab
                {...defaultProps}
                onCreateCheckpoint={onCreateCheckpoint}
            />
        );

        fireEvent.click(screen.getByText('Create Snapshot'));
        expect(onCreateCheckpoint).toHaveBeenCalled();
    });
});
