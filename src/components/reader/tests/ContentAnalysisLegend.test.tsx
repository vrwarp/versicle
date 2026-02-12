import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentAnalysisLegend } from '../ContentAnalysisLegend';
import { useGenAIStore } from '../../../store/useGenAIStore';
import { useReaderUIStore } from '../../../store/useReaderUIStore';
import { dbService } from '../../../db/DBService';
import React from 'react';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  X: () => <span data-testid="icon-x" />,
  Copy: () => <span data-testid="icon-copy" />,
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
  RotateCcw: () => <span data-testid="icon-rotate-ccw" />,
  Loader2: () => <span data-testid="icon-loader" />,
  FileText: () => <span data-testid="icon-file-text" />,
}));

// Mock Store
vi.mock('../../../store/useGenAIStore', () => ({
  useGenAIStore: vi.fn(),
}));

// Mock Reader Store
vi.mock('../../../store/useReaderUIStore', () => ({
  useReaderUIStore: vi.fn(),
}));

// Mock DBService
vi.mock('../../../db/DBService', () => ({
  dbService: {
    getTableImages: vi.fn(),
  },
}));

describe('ContentAnalysisLegend', () => {
  const mockSetDebugModeEnabled = vi.fn();
  const mockRendition = {
    on: vi.fn(),
    off: vi.fn(),
    display: vi.fn(),
    getRange: vi.fn(),
    getContents: vi.fn(),
    annotations: {
        add: vi.fn(),
        remove: vi.fn(),
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useGenAIStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        isDebugModeEnabled: true,
        setDebugModeEnabled: mockSetDebugModeEnabled,
      })
    );
    (useReaderUIStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector?: (state: unknown) => unknown) => {
        const state = {
            currentBookId: 'book1',
            toc: []
        };
        return selector ? selector(state) : state;
    });
  });

  it('renders nothing when debug mode is disabled', () => {
    (useGenAIStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          isDebugModeEnabled: false,
          setDebugModeEnabled: mockSetDebugModeEnabled,
        })
      );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ContentAnalysisLegend rendition={mockRendition as any} />);
    expect(screen.queryByText('Debug Panel')).toBeNull();
  });

  it('renders correctly when debug mode is enabled', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ContentAnalysisLegend rendition={mockRendition as any} />);
    expect(screen.getByText('Debug Panel')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('epubcfi(...)')).toBeInTheDocument();
  });

  it('toggles expansion', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ContentAnalysisLegend rendition={mockRendition as any} />);

    // Simulate selection event
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onSelected = mockRendition.on.mock.calls.find((call: any[]) => call[0] === 'selected')[1];

    mockRendition.getRange.mockReturnValue({ toString: () => 'Selected Text' });

    act(() => {
        onSelected('epubcfi(/6/2!/4/2)', {});
    });

    const input = screen.getByPlaceholderText('epubcfi(...)') as HTMLInputElement;
    expect(input.value).toBe('epubcfi(/6/2!/4/2)');
    expect(screen.getByDisplayValue('Selected Text')).toBeInTheDocument();
  });

  it('updates rendition on manual CFI input', async () => {
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  it('highlights table when jumping from image', async () => {
    // Setup mock image
    const mockImage = {
        id: 'book1-cfi1',
        bookId: 'book1',
        sectionId: 'section1',
        cfi: 'epubcfi(/6/10)',
        imageBlob: new Blob([''], { type: 'image/webp' })
    };
    (dbService.getTableImages as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([mockImage]);

    // Mock URL.createObjectURL
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:http://localhost/uuid');
    global.URL.createObjectURL = mockCreateObjectURL;

    // Render
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ContentAnalysisLegend rendition={mockRendition as any} />);

    // Wait for images to load (wait for "Table Images" text)
    // The text is "Table Images (1)"
    const header = await screen.findByText(/Table Images/i);
    expect(header).toBeInTheDocument();

    // Click JUMP button
    // It's in a button with text "JUMP"
    const jumpButton = screen.getByText('JUMP');
    fireEvent.click(jumpButton);

    // Verify display called
    expect(mockRendition.display).toHaveBeenCalledWith('epubcfi(/6/10)');

    // Verify annotation added
    expect(mockRendition.annotations.add).toHaveBeenCalledWith(
        'highlight',
        'epubcfi(/6/10)',
        expect.anything(),
        null,
        'temp-table-highlight',
        expect.objectContaining({
            fill: 'yellow'
        })
    );
  });
});
