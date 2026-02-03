import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TOCPanel, TOCPanelProps } from './TOCPanel';
import type { NavigationItem } from 'epubjs';

// Mock the ReadingHistoryPanel since it has complex dependencies
vi.mock('../ReadingHistoryPanel', () => ({
    ReadingHistoryPanel: () => <div data-testid="reading-history-panel-mock">History Panel</div>
}));

// Mock DeviceIcon
vi.mock('../DeviceIcon', () => ({
    DeviceIcon: ({ platform, className }: { platform: string; className?: string }) => (
        <span data-testid={`device-icon-${platform}`} className={className}>📱</span>
    )
}));

describe('TOCPanel', () => {
    const mockToc: NavigationItem[] = [
        { id: 'ch1', href: 'chapter1.xhtml', label: 'Chapter 1', subitems: [] },
        { id: 'ch2', href: 'chapter2.xhtml', label: 'Chapter 2', subitems: [] },
        {
            id: 'ch3', href: 'chapter3.xhtml', label: 'Chapter 3', subitems: [
                { id: 'ch3-1', href: 'chapter3-1.xhtml', label: 'Section 3.1', subitems: [] }
            ]
        }
    ];

    const defaultProps: TOCPanelProps = {
        toc: mockToc,
        syntheticToc: [],
        useSyntheticToc: false,
        onUseSyntheticTocChange: vi.fn(),
        activeTocId: undefined,
        deviceMarkers: {},
        onNavigate: vi.fn(),
        isEnhancing: false,
        tocProgress: null,
        onEnhanceTOC: vi.fn(),
        bookId: 'test-book',
        rendition: undefined,
        historyTick: 0,
        onHistoryNavigate: vi.fn()
    };

    it('renders TOC panel with chapters', () => {
        render(<TOCPanel {...defaultProps} />);

        expect(screen.getByTestId('reader-toc-sidebar')).toBeInTheDocument();
        expect(screen.getByText('Chapter 1')).toBeInTheDocument();
        expect(screen.getByText('Chapter 2')).toBeInTheDocument();
        expect(screen.getByText('Chapter 3')).toBeInTheDocument();
    });

    it('renders tabs for chapters and history', () => {
        render(<TOCPanel {...defaultProps} />);

        expect(screen.getByTestId('tab-chapters')).toBeInTheDocument();
        expect(screen.getByTestId('tab-history')).toBeInTheDocument();
    });

    it('renders nested TOC items', () => {
        render(<TOCPanel {...defaultProps} />);

        expect(screen.getByText('Section 3.1')).toBeInTheDocument();
    });

    it('calls onNavigate when TOC item clicked', () => {
        const onNavigate = vi.fn();
        render(<TOCPanel {...defaultProps} onNavigate={onNavigate} />);

        fireEvent.click(screen.getByText('Chapter 1'));
        expect(onNavigate).toHaveBeenCalledWith('chapter1.xhtml');
    });

    it('highlights active TOC item', () => {
        render(<TOCPanel {...defaultProps} activeTocId="ch2" />);

        const ch2Button = screen.getByText('Chapter 2').closest('button');
        expect(ch2Button).toHaveClass('text-primary');
    });

    it('shows synthetic TOC toggle', () => {
        render(<TOCPanel {...defaultProps} />);

        expect(screen.getByText('Generated Titles')).toBeInTheDocument();
    });

    it('calls onUseSyntheticTocChange when toggle clicked', () => {
        const onUseSyntheticTocChange = vi.fn();
        render(<TOCPanel {...defaultProps} onUseSyntheticTocChange={onUseSyntheticTocChange} />);

        const toggle = screen.getByRole('switch');
        fireEvent.click(toggle);
        expect(onUseSyntheticTocChange).toHaveBeenCalledWith(true);
    });

    it('shows enhance button when synthetic TOC is enabled', () => {
        render(<TOCPanel {...defaultProps} useSyntheticToc={true} syntheticToc={mockToc} />);

        expect(screen.getByText('Enhance Titles with AI')).toBeInTheDocument();
    });

    it('shows enhancing state', () => {
        render(
            <TOCPanel
                {...defaultProps}
                useSyntheticToc={true}
                syntheticToc={mockToc}
                isEnhancing={true}
                tocProgress={{ current: 2, total: 5 }}
            />
        );

        expect(screen.getByText('Enhancing... (2/5)')).toBeInTheDocument();
    });

    it('calls onEnhanceTOC when enhance button clicked', () => {
        const onEnhanceTOC = vi.fn();
        render(<TOCPanel {...defaultProps} useSyntheticToc={true} syntheticToc={mockToc} onEnhanceTOC={onEnhanceTOC} />);

        fireEvent.click(screen.getByText('Enhance Titles with AI'));
        expect(onEnhanceTOC).toHaveBeenCalled();
    });

    it('shows device markers on TOC items', () => {
        const deviceMarkers = {
            'chapter1.xhtml': [
                { id: 'device1', name: 'iPhone', platform: 'ios' }
            ]
        };
        render(<TOCPanel {...defaultProps} deviceMarkers={deviceMarkers} />);

        expect(screen.getByTestId('device-icon-ios')).toBeInTheDocument();
    });

    it('shows empty state for synthetic TOC', () => {
        render(<TOCPanel {...defaultProps} useSyntheticToc={true} syntheticToc={[]} />);

        expect(screen.getByText('No generated titles available.')).toBeInTheDocument();
    });
});
