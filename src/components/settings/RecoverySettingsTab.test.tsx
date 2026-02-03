import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RecoverySettingsTab, RecoverySettingsTabProps } from './RecoverySettingsTab';

describe('RecoverySettingsTab', () => {
    const defaultProps: RecoverySettingsTabProps = {
        checkpoints: [],
        recoveryStatus: null,
        onRestoreCheckpoint: vi.fn()
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
            { id: 1, timestamp: 1706900000000, trigger: 'manual' },
            { id: 2, timestamp: 1706900100000, trigger: 'sync' }
        ];
        render(<RecoverySettingsTab {...defaultProps} checkpoints={checkpoints} />);

        expect(screen.getByText('Trigger: manual')).toBeInTheDocument();
        expect(screen.getByText('Trigger: sync')).toBeInTheDocument();
        expect(screen.getAllByText('Restore')).toHaveLength(2);
    });

    it('shows recovery status when present', () => {
        render(<RecoverySettingsTab {...defaultProps} recoveryStatus="Restoring..." />);

        expect(screen.getByText('Restoring...')).toBeInTheDocument();
    });

    it('calls onRestoreCheckpoint when restore clicked', () => {
        const onRestoreCheckpoint = vi.fn();
        const checkpoints = [{ id: 42, timestamp: Date.now(), trigger: 'manual' }];
        render(
            <RecoverySettingsTab
                {...defaultProps}
                checkpoints={checkpoints}
                onRestoreCheckpoint={onRestoreCheckpoint}
            />
        );

        fireEvent.click(screen.getByText('Restore'));
        expect(onRestoreCheckpoint).toHaveBeenCalledWith(42);
    });
});
