import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TTSAbbreviationSettings } from './TTSAbbreviationSettings';
import { vi } from 'vitest';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
    X: () => <span data-testid="icon-x" />,
    Plus: () => <span data-testid="icon-plus" />,
    RotateCcw: () => <span data-testid="icon-rotate-ccw" />,
    Download: () => <span data-testid="icon-download" />,
    Upload: () => <span data-testid="icon-upload" />,
}));

// Mock useTTSStore
const mockSetCustomAbbreviations = vi.fn();
const mockSetAlwaysMerge = vi.fn();
const mockSetSentenceStarters = vi.fn();

vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: vi.fn(() => ({
        customAbbreviations: ['Mr.', 'Dr.'],
        setCustomAbbreviations: mockSetCustomAbbreviations,
        alwaysMerge: ['Mr.'],
        setAlwaysMerge: mockSetAlwaysMerge,
        sentenceStarters: ['He'],
        setSentenceStarters: mockSetSentenceStarters
    })),
}));

describe('TTSAbbreviationSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.alert = vi.fn();
        window.confirm = vi.fn(() => true);

        // Mock URL.createObjectURL
        global.URL.createObjectURL = vi.fn(() => 'blob:url');
        global.URL.revokeObjectURL = vi.fn();
    });

    it('renders export and import buttons for all sections', () => {
        render(<TTSAbbreviationSettings />);
        expect(screen.getAllByTitle('Download CSV')).toHaveLength(3);
        expect(screen.getAllByTitle('Upload CSV')).toHaveLength(3);
    });

    it('handles download for abbreviations', () => {
        render(<TTSAbbreviationSettings />);

        const clickMock = vi.fn();
        const originalCreateElement = document.createElement.bind(document);

        const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
             if (tagName === 'a') {
                 const anchor = originalCreateElement('a');
                 anchor.click = clickMock;
                 return anchor;
             }
             return originalCreateElement(tagName, options);
        });

        const downloadButtons = screen.getAllByTitle('Download CSV');
        fireEvent.click(downloadButtons[0]); // Abbreviations

        expect(createElementSpy).toHaveBeenCalledWith('a');
        expect(clickMock).toHaveBeenCalled();
        expect(global.URL.createObjectURL).toHaveBeenCalled();

        createElementSpy.mockRestore();
    });

    it('handles upload for abbreviations', async () => {
        render(<TTSAbbreviationSettings />);

        const file = new File(['Abbreviation\nNew1.\nNew2.'], 'test.csv', { type: 'text/csv' });
        const input = screen.getByTestId('csv-upload-abbreviations');

        // Mock FileReader
        const mockReadAsText = vi.fn();

        const MockFileReader = class {
            readAsText = mockReadAsText;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onload = null as any;
            result = '';
            constructor() {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (global as any).__mockFileReader = this;
            }
        };

        vi.stubGlobal('FileReader', MockFileReader);

        fireEvent.change(input, { target: { files: [file] } });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const readerInstance = (global as any).__mockFileReader;
        expect(mockReadAsText).toHaveBeenCalledWith(file);

        // Simulate onload
        readerInstance.result = 'Abbreviation\nNew1.\nNew2.';
        readerInstance.onload({ target: { result: readerInstance.result } });

        expect(window.confirm).toHaveBeenCalled();
        expect(mockSetCustomAbbreviations).toHaveBeenCalledWith(['New1.', 'New2.']);

        vi.unstubAllGlobals();
    });

     it('handles upload for sentence starters without header', async () => {
        render(<TTSAbbreviationSettings />);

        const file = new File(['NewStarter'], 'test.csv', { type: 'text/csv' });
        // Sentence Starters is the 3rd section
        const input = screen.getByTestId('csv-upload-sentence-starters');

        const mockReadAsText = vi.fn();

        const MockFileReader = class {
            readAsText = mockReadAsText;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onload = null as any;
            result = '';
            constructor() {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (global as any).__mockFileReader = this;
            }
        };

        vi.stubGlobal('FileReader', MockFileReader);

        fireEvent.change(input, { target: { files: [file] } });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const readerInstance = (global as any).__mockFileReader;

        readerInstance.result = 'NewStarter';
        readerInstance.onload({ target: { result: readerInstance.result } });

        expect(window.confirm).toHaveBeenCalled();
        expect(mockSetSentenceStarters).toHaveBeenCalledWith(['NewStarter']);

        vi.unstubAllGlobals();
    });
});
