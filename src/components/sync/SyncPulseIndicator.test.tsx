import React from 'react';
import { render, screen } from '@testing-library/react';
import { SyncPulseIndicator } from './SyncPulseIndicator';
import { useSyncStore } from '../../lib/sync/hooks/useSyncStore';
import { vi } from 'vitest';

// Mock the store hook
vi.mock('../../lib/sync/hooks/useSyncStore');

// Define the state type based on the hook
type SyncStoreState = ReturnType<typeof useSyncStore>;

const defaultMockState: SyncStoreState = {
  syncProvider: 'none',
  setSyncProvider: vi.fn(),
  firebaseConfig: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  },
  setFirebaseConfig: vi.fn(),
  firebaseEnabled: false,
  setFirebaseEnabled: vi.fn(),
  firestoreStatus: 'disconnected',
  setFirestoreStatus: vi.fn(),
  firebaseAuthStatus: 'loading',
  setFirebaseAuthStatus: vi.fn(),
  firebaseUserEmail: null,
  setFirebaseUserEmail: vi.fn(),
  lastSyncTime: null,
  setLastSyncTime: vi.fn(),
};

describe('SyncPulseIndicator', () => {
  it('renders with correct status role and accessible text for connected state', () => {
    vi.mocked(useSyncStore).mockReturnValue({
      ...defaultMockState,
      firestoreStatus: 'connected',
      lastSyncTime: new Date('2023-01-01T12:00:00').getTime(),
    });

    render(<SyncPulseIndicator />);

    const indicator = screen.getByRole('status');
    expect(indicator).toBeInTheDocument();
    expect(screen.getByText(/Synced/)).toBeInTheDocument();
  });

  it('renders with correct status role and accessible text for syncing state', () => {
    vi.mocked(useSyncStore).mockReturnValue({
      ...defaultMockState,
      firestoreStatus: 'connecting',
    });

    render(<SyncPulseIndicator />);

    const indicator = screen.getByRole('status');
    expect(indicator).toBeInTheDocument();
    expect(screen.getByText('Syncing...')).toBeInTheDocument();
  });

  it('renders with correct status role and accessible text for error state', () => {
    vi.mocked(useSyncStore).mockReturnValue({
      ...defaultMockState,
      firestoreStatus: 'error',
    });

    render(<SyncPulseIndicator />);

    const indicator = screen.getByRole('status');
    expect(indicator).toBeInTheDocument();

    // We expect the sr-only text. The visible text is aria-hidden, so relying on selector to disambiguate if needed
    // or just verifying the accessible text presence.
    expect(screen.getByText('Sync Error', { selector: '.sr-only' })).toBeInTheDocument();
  });
});
