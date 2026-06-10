import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeSynchronizer } from './ThemeSynchronizer';
import { usePreferencesStore } from '../store/usePreferencesStore';

// Mock the store
vi.mock('../store/usePreferencesStore', () => ({
  usePreferencesStore: vi.fn(),
}));

describe('ThemeSynchronizer', () => {
  beforeEach(() => {
    // Clear any classes on the document element before each test
    document.documentElement.className = '';
    vi.clearAllMocks();
  });

  it('adds "light" class to document when currentTheme is "light"', () => {
    vi.mocked(usePreferencesStore).mockImplementation((selector: (state: ReturnType<typeof usePreferencesStore["getState"]>) => unknown) =>
      selector({ currentTheme: 'light' } as unknown as ReturnType<typeof usePreferencesStore.getState>)
    );

    render(<ThemeSynchronizer />);

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('sepia')).toBe(false);
  });

  it('adds "dark" class to document when currentTheme is "dark"', () => {
    vi.mocked(usePreferencesStore).mockImplementation((selector: (state: ReturnType<typeof usePreferencesStore["getState"]>) => unknown) =>
      selector({ currentTheme: 'dark' } as unknown as ReturnType<typeof usePreferencesStore.getState>)
    );

    render(<ThemeSynchronizer />);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('adds "sepia" class to document when currentTheme is "sepia"', () => {
    vi.mocked(usePreferencesStore).mockImplementation((selector: (state: ReturnType<typeof usePreferencesStore["getState"]>) => unknown) =>
      selector({ currentTheme: 'sepia' } as unknown as ReturnType<typeof usePreferencesStore.getState>)
    );

    render(<ThemeSynchronizer />);

    expect(document.documentElement.classList.contains('sepia')).toBe(true);
  });

  it('adds "light" class to document when currentTheme is "custom"', () => {
    vi.mocked(usePreferencesStore).mockImplementation((selector: (state: ReturnType<typeof usePreferencesStore["getState"]>) => unknown) =>
      selector({ currentTheme: 'custom' } as unknown as ReturnType<typeof usePreferencesStore.getState>)
    );

    render(<ThemeSynchronizer />);

    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('removes previous theme class when theme changes', () => {
    // Start with dark theme
    vi.mocked(usePreferencesStore).mockImplementation((selector: (state: ReturnType<typeof usePreferencesStore["getState"]>) => unknown) =>
      selector({ currentTheme: 'dark' } as unknown as ReturnType<typeof usePreferencesStore.getState>)
    );

    const { rerender } = render(<ThemeSynchronizer />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // Change to sepia theme
    vi.mocked(usePreferencesStore).mockImplementation((selector: (state: ReturnType<typeof usePreferencesStore["getState"]>) => unknown) =>
      selector({ currentTheme: 'sepia' } as unknown as ReturnType<typeof usePreferencesStore.getState>)
    );

    rerender(<ThemeSynchronizer />);

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('sepia')).toBe(true);
  });

  it('defaults to "light" theme if currentTheme is null or undefined', () => {
    vi.mocked(usePreferencesStore).mockImplementation((selector: (state: ReturnType<typeof usePreferencesStore["getState"]>) => unknown) =>
      selector({ currentTheme: undefined } as unknown as ReturnType<typeof usePreferencesStore.getState>)
    );

    render(<ThemeSynchronizer />);

    expect(document.documentElement.classList.contains('light')).toBe(true);
  });
});
