import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentAnalysisLegend } from '../ContentAnalysisLegend';
import { useGenAIStore } from '../../../store/useGenAIStore';
import React from 'react';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  X: () => <span data-testid="icon-x" />,
  Copy: () => <span data-testid="icon-copy" />,
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
}));

// Mock Store
vi.mock('../../../store/useGenAIStore', () => ({
  useGenAIStore: vi.fn(),
}));

describe('ContentAnalysisLegend', () => {
  const mockSetDebugModeEnabled = vi.fn();
  const mockRendition = {
    on: vi.fn(),
    off: vi.fn(),
    display: vi.fn(),
    getRange: vi.fn(),
    getContents: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useGenAIStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: any) =>
      selector({
        isDebugModeEnabled: true,
        setDebugModeEnabled: mockSetDebugModeEnabled,
      })
    );
  });

  it('renders nothing when debug mode is disabled', () => {
    (useGenAIStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: any) =>
        selector({
          isDebugModeEnabled: false,
          setDebugModeEnabled: mockSetDebugModeEnabled,
        })
      );

    render(<ContentAnalysisLegend rendition={mockRendition as any} />);
    expect(screen.queryByText('Debug Panel')).toBeNull();
  });

  it('renders correctly when debug mode is enabled', () => {
    render(<ContentAnalysisLegend rendition={mockRendition as any} />);
    expect(screen.getByText('Debug Panel')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('epubcfi(...)')).toBeInTheDocument();
  });

  it('toggles expansion', () => {
    render(<ContentAnalysisLegend rendition={mockRendition as any} />);

    // Initially expanded
    expect(screen.getByText('Current CFI')).toBeInTheDocument();

    // Click toggle
    fireEvent.click(screen.getByText('Debug Panel'));

    // Should be collapsed (content hidden)
    expect(screen.queryByText('Current CFI')).toBeNull();

    // Click toggle again
    fireEvent.click(screen.getByText('Debug Panel'));
    expect(screen.getByText('Current CFI')).toBeInTheDocument();
  });

  it('updates CFI input on selection', () => {
    render(<ContentAnalysisLegend rendition={mockRendition as any} />);

    // Simulate selection event
    const onSelected = mockRendition.on.mock.calls.find(call => call[0] === 'selected')[1];

    mockRendition.getRange.mockReturnValue({ toString: () => 'Selected Text' });

    act(() => {
        onSelected('epubcfi(/6/2!/4/2)', {});
    });

    const input = screen.getByPlaceholderText('epubcfi(...)') as HTMLInputElement;
    expect(input.value).toBe('epubcfi(/6/2!/4/2)');
    expect(screen.getByDisplayValue('Selected Text')).toBeInTheDocument();
  });

  it('updates rendition on manual CFI input', async () => {
     render(<ContentAnalysisLegend rendition={mockRendition as any} />);
     const input = screen.getByPlaceholderText('epubcfi(...)');

     mockRendition.display.mockResolvedValue(undefined);
     mockRendition.getRange.mockReturnValue({ toString: () => 'New Text' });
     mockRendition.getContents.mockReturnValue([]);

     await act(async () => {
         fireEvent.change(input, { target: { value: 'epubcfi(/6/4)' } });
     });

     expect(mockRendition.display).toHaveBeenCalledWith('epubcfi(/6/4)');
     expect(screen.getByDisplayValue('New Text')).toBeInTheDocument();
  });
});
