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
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: vi.fn(() => ({
        customAbbreviations: ['Mr.', 'Dr.'],
        setCustomAbbreviations: mockSetCustomAbbreviations,
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

    it('renders export and import buttons', () => {
        render(<TTSAbbreviationSettings />);
        expect(screen.getByTitle('Download CSV')).toBeInTheDocument();
        expect(screen.getByTitle('Upload CSV')).toBeInTheDocument();
    });

    it('handles download', () => {
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

        fireEvent.click(screen.getByTitle('Download CSV'));

        expect(createElementSpy).toHaveBeenCalledWith('a');
        expect(clickMock).toHaveBeenCalled();
        expect(global.URL.createObjectURL).toHaveBeenCalled();

        createElementSpy.mockRestore();
    });

    it('handles upload', async () => {
        render(<TTSAbbreviationSettings />);

        const file = new File(['Abbreviation\nNew1.\nNew2.'], 'test.csv', { type: 'text/csv' });
        const input = screen.getByTestId('csv-upload-input');

        // Mock FileReader
        const mockReadAsText = vi.fn();
        const mockFileReaderInstance = {
            readAsText: mockReadAsText,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onload: null as any,
            result: '',
        };

        // Use a class-like mock for FileReader
        const MockFileReader = class {
            readAsText = mockReadAsText;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onload = null as any;
            result = '';
            constructor() {
                // Return the shared instance so we can control it from the test
                // This is a bit of a hack to access the instance created inside the component
                Object.assign(this, mockFileReaderInstance);
                // We update our outer reference so we can trigger callbacks on the *actual* instance used by the component
                // (though in this case since we share state via mockFileReaderInstance's methods it might be enough,
                // but 'onload' is assigned TO the instance, so we need to capture the instance).
                // Actually, let's just use the shared methods, but we need to capture the 'onload' assignment.
                // The component does: reader.onload = ...
                // So we need to be able to read 'onload' back from the instance.

                // Let's capture this instance in a variable accessible to the test
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

     it('handles upload without header', async () => {
        render(<TTSAbbreviationSettings />);

        const file = new File(['MyAbbrev.'], 'test.csv', { type: 'text/csv' });
        const input = screen.getByTestId('csv-upload-input');

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

        readerInstance.result = 'MyAbbrev.';
        readerInstance.onload({ target: { result: readerInstance.result } });

        expect(window.confirm).toHaveBeenCalled();
        expect(mockSetCustomAbbreviations).toHaveBeenCalledWith(['MyAbbrev.']);

        vi.unstubAllGlobals();
    });
});
