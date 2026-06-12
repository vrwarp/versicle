/**
 * Boot failure routing for the CRDT migration coordinator
 * (phase2-fork-surgery.md §5.2 "loud failure → safe mode"):
 *
 *  - a MigrationError rejecting the boot promise renders
 *    CriticalMigrationFailureView with the pre-migration checkpoint id wired
 *    into its existing checkpoint-restore flow;
 *  - every other boot error keeps routing to SafeModeView (pinned by
 *    App_Boot.test.tsx / App_SW_Wait.test.tsx, cross-checked here).
 *
 * Companion of App_Boot.test.tsx, which pins the healthy boot paths and must
 * stay green UNCHANGED alongside this file.
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import App from './App';
import { useBootSequence } from './app/boot/useBootSequence';
import { MigrationError } from './app/migrations';

vi.mock('./app/boot/useBootSequence', () => ({
  useBootSequence: vi.fn(),
}));

vi.mock('./app/boot/useServiceWorkerGate', () => ({
  useServiceWorkerGate: () => ({ swInitialized: true, swError: null }),
}));

vi.mock('./data/wipe', () => ({
  wipeAllData: vi.fn().mockResolvedValue(undefined),
}));

// ── UI surfaces (same mock set as App_Boot.test.tsx) ──
vi.mock('./components/library/LibraryView', () => ({
  LibraryView: () => <div data-testid="library-view">Library View</div>,
}));
vi.mock('./components/reader/ReaderShell', () => ({
  ReaderShell: () => <div data-testid="reader-view">Reader View</div>,
}));
vi.mock('./components/SafeModeView', () => ({
  SafeModeView: () => <div data-testid="safe-mode">SafeMode</div>,
}));
vi.mock('./layouts/RootLayout', () => ({
  RootLayout: () => <div data-testid="root-layout">RootLayout Mock</div>,
}));
vi.mock('react-router-dom', () => ({
  createBrowserRouter: vi.fn(),
  RouterProvider: () => <div data-testid="library-route">Library View</div>,
  Outlet: () => null,
  useNavigate: vi.fn(),
  useLocation: vi.fn().mockReturnValue({ pathname: '/' }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('boot: CRDT migration failure routing', () => {
  it('renders CriticalMigrationFailureView (not SafeModeView) for a MigrationError', () => {
    vi.mocked(useBootSequence).mockReturnValue({
      status: 'error',
      error: new MigrationError('CRDT migration failed at v5 (target v6).', {
        checkpointId: 42,
      }),
    });

    render(<App />);

    // The dedicated failure surface, with its checkpoint-restore button.
    expect(screen.getByRole('button', { name: /restore previous data/i })).toBeInTheDocument();
    expect(screen.queryByTestId('safe-mode')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-route')).not.toBeInTheDocument();
  });

  it('keeps routing non-migration boot errors to SafeModeView', () => {
    vi.mocked(useBootSequence).mockReturnValue({
      status: 'error',
      error: new Error('DB init failed'),
    });

    render(<App />);

    expect(screen.getByTestId('safe-mode')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore previous data/i })).not.toBeInTheDocument();
  });
});
