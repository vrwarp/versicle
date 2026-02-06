import React from 'react';
import { render, screen } from '@testing-library/react';
import { SyncPulseIndicator } from './SyncPulseIndicator';
import { useSyncStore } from '../../lib/sync/hooks/useSyncStore';
import { vi } from 'vitest';

// Mock the store hook
vi.mock('../../lib/sync/hooks/useSyncStore');

describe('SyncPulseIndicator', () => {
  it('renders with correct status role and accessible text for connected state', () => {
    vi.mocked(useSyncStore).mockReturnValue({
      firestoreStatus: 'connected',
      lastSyncTime: new Date('2023-01-01T12:00:00').getTime(),
      isSyncing: false,
      error: null,
      sync: vi.fn(),
      disconnect: vi.fn(),
      connect: vi.fn(),
      // Add missing properties to satisfy the type if needed, or use partial
    } as any);

    render(<SyncPulseIndicator />);

    const indicator = screen.getByRole('status');
    expect(indicator).toBeInTheDocument();
    expect(screen.getByText(/Synced/)).toBeInTheDocument();
  });

  it('renders with correct status role and accessible text for syncing state', () => {
    vi.mocked(useSyncStore).mockReturnValue({
      firestoreStatus: 'connecting',
      lastSyncTime: null,
      isSyncing: true,
      error: null,
      sync: vi.fn(),
      disconnect: vi.fn(),
      connect: vi.fn(),
    } as any);

    render(<SyncPulseIndicator />);

    const indicator = screen.getByRole('status');
    expect(indicator).toBeInTheDocument();
    expect(screen.getByText('Syncing...')).toBeInTheDocument();
  });

  it('renders with correct status role and accessible text for error state', () => {
    vi.mocked(useSyncStore).mockReturnValue({
      firestoreStatus: 'error',
      lastSyncTime: null,
      isSyncing: false,
      error: new Error('Sync failed'),
      sync: vi.fn(),
      disconnect: vi.fn(),
      connect: vi.fn(),
    } as any);

    render(<SyncPulseIndicator />);

    const indicator = screen.getByRole('status');
    expect(indicator).toBeInTheDocument();

    // We expect the sr-only text. The visible text is aria-hidden, so relying on selector to disambiguate if needed
    // or just verifying the accessible text presence.
    expect(screen.getByText('Sync Error', { selector: '.sr-only' })).toBeInTheDocument();
  });
});
