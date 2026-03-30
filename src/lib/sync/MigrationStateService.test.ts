import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MigrationStateService } from './MigrationStateService';

describe('MigrationStateService', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    describe('getState', () => {
        it('should return null when no state is stored', () => {
            expect(MigrationStateService.getState()).toBeNull();
        });

        it('should parse valid state', () => {
            localStorage.setItem('__VERSICLE_MIGRATION_STATE__', JSON.stringify({
                status: 'AWAITING_CONFIRMATION',
                targetWorkspaceId: 'ws_123',
                backupCheckpointId: 42,
            }));
            const state = MigrationStateService.getState();
            expect(state).toEqual({
                status: 'AWAITING_CONFIRMATION',
                targetWorkspaceId: 'ws_123',
                backupCheckpointId: 42,
            });
        });

        it('should return null and clear on malformed JSON', () => {
            localStorage.setItem('__VERSICLE_MIGRATION_STATE__', 'not-json');
            expect(MigrationStateService.getState()).toBeNull();
            expect(localStorage.getItem('__VERSICLE_MIGRATION_STATE__')).toBeNull();
        });

        it('should return null if status is missing', () => {
            localStorage.setItem('__VERSICLE_MIGRATION_STATE__', JSON.stringify({
                targetWorkspaceId: 'ws_123',
            }));
            expect(MigrationStateService.getState()).toBeNull();
        });
    });

    describe('setState', () => {
        it('should serialize state to localStorage', () => {
            MigrationStateService.setState({
                status: 'RESTORING_BACKUP',
                targetWorkspaceId: 'ws_abc',
                backupCheckpointId: 7,
            });
            const raw = localStorage.getItem('__VERSICLE_MIGRATION_STATE__');
            expect(raw).toBeTruthy();
            const parsed = JSON.parse(raw!);
            expect(parsed.status).toBe('RESTORING_BACKUP');
            expect(parsed.backupCheckpointId).toBe(7);
        });
    });

    describe('clear', () => {
        it('should remove the key from localStorage', () => {
            MigrationStateService.setState({ status: 'IDLE' });
            MigrationStateService.clear();
            expect(localStorage.getItem('__VERSICLE_MIGRATION_STATE__')).toBeNull();
        });
    });

    describe('isBlocked', () => {
        it('should return false when no state exists', () => {
            expect(MigrationStateService.isBlocked()).toBe(false);
        });

        it('should return false for IDLE status', () => {
            MigrationStateService.setState({ status: 'IDLE' });
            expect(MigrationStateService.isBlocked()).toBe(false);
        });

        it('should return true for AWAITING_CONFIRMATION', () => {
            MigrationStateService.setState({ status: 'AWAITING_CONFIRMATION' });
            expect(MigrationStateService.isBlocked()).toBe(true);
        });

        it('should return true for RESTORING_BACKUP', () => {
            MigrationStateService.setState({ status: 'RESTORING_BACKUP' });
            expect(MigrationStateService.isBlocked()).toBe(true);
        });
    });

    describe('setAwaitingConfirmation', () => {
        it('should set status with target and backup ID', () => {
            MigrationStateService.setAwaitingConfirmation('ws_target', 99);
            const state = MigrationStateService.getState();
            expect(state).toEqual({
                status: 'AWAITING_CONFIRMATION',
                targetWorkspaceId: 'ws_target',
                backupCheckpointId: 99,
            });
        });
    });

    describe('setRestoringBackup', () => {
        it('should transition from AWAITING_CONFIRMATION preserving IDs', () => {
            MigrationStateService.setAwaitingConfirmation('ws_target', 42);
            MigrationStateService.setRestoringBackup();
            const state = MigrationStateService.getState();
            expect(state).toEqual({
                status: 'RESTORING_BACKUP',
                targetWorkspaceId: 'ws_target',
                backupCheckpointId: 42,
            });
        });

        it('should not transition when no current state exists', () => {
            MigrationStateService.setRestoringBackup();
            expect(MigrationStateService.getState()).toBeNull();
        });
    });

    describe('getDanglingBackupId', () => {
        it('should return null when no state exists', () => {
            expect(MigrationStateService.getDanglingBackupId()).toBeNull();
        });

        it('should return null for non-IDLE status', () => {
            MigrationStateService.setState({
                status: 'AWAITING_CONFIRMATION',
                backupCheckpointId: 5,
            });
            expect(MigrationStateService.getDanglingBackupId()).toBeNull();
        });

        it('should return checkpoint ID for IDLE with orphaned backup', () => {
            MigrationStateService.setState({
                status: 'IDLE',
                backupCheckpointId: 5,
            });
            expect(MigrationStateService.getDanglingBackupId()).toBe(5);
        });

        it('should return null for IDLE without backup', () => {
            MigrationStateService.setState({ status: 'IDLE' });
            expect(MigrationStateService.getDanglingBackupId()).toBeNull();
        });
    });
});
