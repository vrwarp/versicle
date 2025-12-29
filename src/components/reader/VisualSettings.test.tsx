import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VisualSettings } from './VisualSettings';
import { useReaderStore } from '../../store/useReaderStore';

// Mock zustand store
vi.mock('../../store/useReaderStore', () => ({
  useReaderStore: vi.fn(),
}));

// Mock zustand shallow
vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: any) => selector,
}));

// Mock Popover components since they depend on Radix Context
vi.mock('../ui/Popover', () => ({
  PopoverContent: ({ children, className }: any) => <div className={className} data-testid="popover-content">{children}</div>,
  PopoverClose: ({ children }: any) => <div data-testid="close-button">{children}</div>,
}));

// Mock Tabs since they depend on Radix Context
vi.mock('../ui/Tabs', () => ({
  Tabs: ({ value, onValueChange, children }: any) => (
    <div data-testid="tabs" data-value={value} onClick={(e: any) => {
        if (e.target.dataset.value && e.target.dataset.value !== value) {
            onValueChange(e.target.dataset.value);
        }
    }}>
        {children}
    </div>
  ),
  TabsList: ({ children }: any) => <div>{children}</div>,
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
  const mockSetViewMode = vi.fn();
  const mockSetLineHeight = vi.fn();
  const mockSetShouldForceFont = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useReaderStore as any).mockImplementation((selector: any) => selector({
      currentTheme: 'light',
      setTheme: mockSetTheme,
      fontSize: 100,
      setFontSize: mockSetFontSize,
      fontFamily: 'serif',
      setFontFamily: mockSetFontFamily,
      viewMode: 'paginated',
      setViewMode: mockSetViewMode,
      lineHeight: 1.5,
      setLineHeight: mockSetLineHeight,
      shouldForceFont: false,
      setShouldForceFont: mockSetShouldForceFont,
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
    expect(mockSetFontSize).toHaveBeenCalledWith(110);
  });

  it('renders layout options', () => {
    render(<VisualSettings />);
    expect(screen.getByText('Paginated')).toBeInTheDocument();
    expect(screen.getByText('Scrolled')).toBeInTheDocument();
  });

  it('changes layout mode', () => {
    render(<VisualSettings />);
    fireEvent.click(screen.getByText('Scrolled'));
    expect(mockSetViewMode).toHaveBeenCalledWith('scrolled');
  });
});
