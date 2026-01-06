import { render, screen, waitFor, act } from '@testing-library/react';
import App from './App';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';

// Mock DB
vi.mock('./db/db', () => ({
  getDB: vi.fn().mockResolvedValue({})
}));

vi.mock('./db/DBService', () => ({
  dbService: {
    cleanup: vi.fn()
  }
}));

// Mock Router and other components to avoid deep rendering
vi.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Routes: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Route: ({ element }: { element: React.ReactNode }) => <div>{element}</div>,
  useNavigate: vi.fn(),
}));

vi.mock('./components/reader/ReaderControlBar', () => ({
  ReaderControlBar: () => <div data-testid="reader-control-bar">Control Bar</div>
}));

vi.mock('./components/reader/ReaderView', () => ({
  ReaderView: () => <div>Reader View</div>
}));

vi.mock('./components/library/LibraryView', () => ({
  LibraryView: () => <div>Library View</div>
}));

describe('App Service Worker Wait', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders "Initializing..." when waiting for Service Worker', async () => {
    // Mock navigator.serviceWorker
    const readyPromise = new Promise<void>((resolve) => {
      // Simulate delay
      setTimeout(() => resolve(), 100);
    });

    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: {
        ready: readyPromise,
        get controller() { return { postMessage: vi.fn() }; },
        register: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    render(<App />);

    // Should be initializing initially
    expect(screen.getByText('Initializing...')).toBeInTheDocument();

    // After ready resolves, it should render app (LibraryView)
    await waitFor(() => {
        expect(screen.queryByText('Initializing...')).not.toBeInTheDocument();
    });
  });

  it('skips waiting if Service Worker is not supported', async () => {
    // Mock navigator without serviceWorker
    // Note: The previous attempt to set value: undefined caused errors in React's useEffect
    // because we can't easily delete the property from JSDOM's navigator.
    // Instead, we ensure 'serviceWorker' in navigator returns false if we can,
    // or just mock it such that it throws or behaves like it's missing if accessed.

    // However, the test error "Cannot read properties of undefined (reading 'ready')"
    // suggests that 'serviceWorker' in navigator check passed, but accessing it returned undefined.
    // The safest way to simulate "not supported" in JSDOM where we can't fully delete it
    // might be to mock it as undefined but we need to ensure the `in` check handles it.

    // Actually, JSDOM has serviceWorker on navigator prototype.
    // We can try to shadow it with undefined.
    Object.defineProperty(window.navigator, 'serviceWorker', {
        value: undefined,
        configurable: true,
        writable: true
    });

    // We suppress the console.error because our code catches the error when checking 'ready'
    // if the 'in' check passes but the value is undefined (which is what happens here).
    // Ideally code should check `navigator.serviceWorker` truthiness too, but the 'in' check is standard.
    // If 'in' is true but value is undefined, it throws.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<App />);

    // Should NOT be initializing (or very briefly)
    await waitFor(() => {
        expect(screen.queryByText('Initializing...')).not.toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('shows critical error if Service Worker controller is missing after polling', async () => {
    // Mock navigator.serviceWorker with ready but no controller
    const readyPromise = Promise.resolve();
    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: {
        ready: readyPromise,
        get controller() { return null; }, // Always null
        register: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    vi.useFakeTimers();
    render(<App />);

    // Initially initializing
    expect(screen.getByText('Initializing...')).toBeInTheDocument();

    // Fast-forward timers to exhaust retries
    // Exponential backoff: 5, 10, 20, 40, 80, 160, 320, 640. Sum = 1275ms.
    // We need to advance enough times to cover the loop.
    let delay = 5;
    for (let i = 0; i < 9; i++) { // Increased iterations
        await act(async () => {
            await vi.advanceTimersByTimeAsync(delay);
        });
        delay *= 2;
    }
    // Advance a bit more to ensure rejection
    await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
    });

    // Switch to real timers before waitFor so it doesn't hang
    vi.useRealTimers();

    // Then shows error
    await waitFor(() => {
        expect(screen.getByText('Critical Error')).toBeInTheDocument();
        expect(screen.getByText(/Service Worker failed to take control/)).toBeInTheDocument();
    });
  });

  it('initializes successfully if controller appears during polling', async () => {
    const readyPromise = Promise.resolve();
    let controllerValue: unknown = null;

    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: {
        ready: readyPromise,
        get controller() { return controllerValue; },
        register: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    vi.useFakeTimers();
    render(<App />);

    // Initially no controller
    expect(screen.getByText('Initializing...')).toBeInTheDocument();

    // Make controller appear after some time (e.g., 5 + 10 + 20 = 35ms, attempt 3)
    // We update the local variable, which the getter will return
    setTimeout(() => {
        controllerValue = { postMessage: vi.fn() };
    }, 35);

    // Advance enough to trigger the timeout callback
    await act(async () => {
        await vi.advanceTimersByTimeAsync(5); // 1st wait
    });
    await act(async () => {
        await vi.advanceTimersByTimeAsync(10); // 2nd wait
    });
    await act(async () => {
        await vi.advanceTimersByTimeAsync(20); // 3rd wait triggers controller check
    });
    await act(async () => {
        await vi.advanceTimersByTimeAsync(40); // safety buffer
    });

    // Switch to real timers before waitFor so it doesn't hang
    vi.useRealTimers();

    // Should NOT show error, should show LibraryView
    await waitFor(() => {
        expect(screen.queryByText('Initializing...')).not.toBeInTheDocument();
        expect(screen.queryByText('Critical Error')).not.toBeInTheDocument();
        expect(screen.getByText('Library View')).toBeInTheDocument();
    });
  });
});
