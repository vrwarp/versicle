/**
 * MigrationStateService
 *
 * Manages the localStorage-backed state machine that bridges page reloads
 * during workspace context switches. The state machine prevents the boot
 * sequence from initializing sync while a migration is in-flight.
 */
import type { SyncMigrationState } from '~types/workspace';
import { createLogger } from '../logger';

const logger = createLogger('MigrationState');

const STORAGE_KEY = '__VERSICLE_MIGRATION_STATE__';

export class MigrationStateService {
    /**
     * Read the current migration state from localStorage.
     * Returns null if no state is stored or if parsing fails.
     */
    static getState(): SyncMigrationState | null {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const state: SyncMigrationState = JSON.parse(raw);
            // Basic validation
            if (!state.status) return null;
            return state;
        } catch (e) {
            logger.warn('Failed to parse migration state, clearing:', e);
            MigrationStateService.clear();
            return null;
        }
    }

    /**
     * Write a migration state to localStorage.
     */
    static setState(state: SyncMigrationState): void {
        logger.info(`Setting migration state: ${state.status}`, state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    /**
     * Clear the migration state entirely.
     */
    static clear(): void {
        logger.info('Clearing migration state');
        localStorage.removeItem(STORAGE_KEY);
    }

    /**
     * Transition to AWAITING_CONFIRMATION.
     * Called after backup and remote state hydration, before reload.
     */
    static setAwaitingConfirmation(targetWorkspaceId: string, backupCheckpointId: number): void {
        MigrationStateService.setState({
            status: 'AWAITING_CONFIRMATION',
            targetWorkspaceId,
            backupCheckpointId,
        });
    }

    /**
     * Transition to RESTORING_BACKUP.
     * Called when user rejects the switch or ErrorBoundary detects a crash.
     */
    static setRestoringBackup(): void {
        const current = MigrationStateService.getState();
        if (!current) {
            logger.error('Cannot transition to RESTORING_BACKUP: no current state');
            return;
        }
        MigrationStateService.setState({
            status: 'RESTORING_BACKUP',
            targetWorkspaceId: current.targetWorkspaceId,
            backupCheckpointId: current.backupCheckpointId,
        });
    }
}
