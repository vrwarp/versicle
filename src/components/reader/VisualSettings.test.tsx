import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VisualSettings } from './VisualSettings';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { useReaderUIStore } from '../../store/useReaderUIStore';
import { useBookStore } from '../../store/useBookStore';

// Mock zustand store
vi.mock('../../store/usePreferencesStore', () => ({
  usePreferencesStore: vi.fn(),
}));
vi.mock('../../store/useReaderUIStore', () => ({
  useReaderUIStore: vi.fn(),
}));
vi.mock('../../store/useBookStore', () => ({
  useBookStore: vi.fn(),
}));

// Mock zustand shallow
vi.mock('zustand/react/shallow', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useShallow: (selector: any) => selector,
}));

// Mock Popover components since they depend on Radix Context
vi.mock('../ui/Popover', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PopoverContent: ({ children, className }: any) => <div className={className} data-testid="popover-content">{children}</div>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PopoverClose: ({ children }: any) => <div data-testid="close-button">{children}</div>,
}));

// Mock Tabs since they depend on Radix Context
vi.mock('../ui/Tabs', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Tabs: ({ value, onValueChange, children }: any) => (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <div data-testid="tabs" data-value={value} onClick={(e: any) => {
      if (e.target.dataset.value && e.target.dataset.value !== value) {
        onValueChange(e.target.dataset.value);
      }
    }}>
      {children}
    </div>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TabsList: ({ children }: any) => <div>{children}</div>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TabsTrigger: ({ value, children }: any) => (
    <button data-value={value} type="button">
      {children}
    </button>
  ),
}));

describe('VisualSettings', () => {
  const mockSetTheme = vi.fn();
  const mockSetFontSize = vi.fn();
  const mockSetFontFamily = vi.fn();
  const mockSetReaderViewMode = vi.fn();
  const mockSetLineHeight = vi.fn();
  const mockSetShouldForceFont = vi.fn();
  const mockSetFontProfile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (usePreferencesStore as any).mockImplementation((selector: any) => selector({
      currentTheme: 'light',
      setTheme: mockSetTheme,
      fontSize: 100,
      setFontSize: mockSetFontSize,
      fontFamily: 'serif',
      setFontFamily: mockSetFontFamily,
      lineHeight: 1.5,
      setLineHeight: mockSetLineHeight,
      shouldForceFont: false,
      setShouldForceFont: mockSetShouldForceFont,
      readerViewMode: 'paginated',
      setReaderViewMode: mockSetReaderViewMode,
      fontProfiles: {
        en: { fontSize: 100, lineHeight: 1.5 },
      },
      setFontProfile: mockSetFontProfile,
      forceTraditionalChinese: false,
      showPinyin: false,
      pinyinSize: 100,
      setForceTraditionalChinese: vi.fn(),
      setShowPinyin: vi.fn(),
      setPinyinSize: vi.fn(),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useReaderUIStore as any).mockImplementation((selector: any) => selector({
      currentBookId: 'test-book',
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useBookStore as any).mockImplementation((selector: any) => selector({
      books: {
        'test-book': { id: 'test-book', language: 'en' },
      },
    }));
  });

  it('renders theme selector', () => {
    render(<VisualSettings />);
    expect(screen.getByText('Ambience')).toBeInTheDocument();
    expect(screen.getByText('White')).toBeInTheDocument();
    expect(screen.getByText('Sepia')).toBeInTheDocument();
    expect(screen.getByText('Dark')).toBeInTheDocument();
  });

  it('changes theme on click', () => {
    render(<VisualSettings />);
    fireEvent.click(screen.getByText('Dark'));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('renders font size controls', () => {
    render(<VisualSettings />);
    expect(screen.getByLabelText('Decrease font size')).toBeInTheDocument();
    expect(screen.getByLabelText('Increase font size')).toBeInTheDocument();
  });

  it('changes font size', () => {
    render(<VisualSettings />);
    fireEvent.click(screen.getByLabelText('Increase font size'));
    expect(mockSetFontProfile).toHaveBeenCalledWith('en', { fontSize: 110 });
  });

  it('renders layout options', () => {
    render(<VisualSettings />);
    expect(screen.getByText('Paginated')).toBeInTheDocument();
    expect(screen.getByText('Scrolled')).toBeInTheDocument();
  });

  it('changes layout mode', () => {
    render(<VisualSettings />);
    fireEvent.click(screen.getByText('Scrolled'));
    expect(mockSetReaderViewMode).toHaveBeenCalledWith('scrolled');
  });
});
