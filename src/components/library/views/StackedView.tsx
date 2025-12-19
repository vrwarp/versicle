import React, { useState } from 'react';
import { ModernCardView } from './components/ModernCardView';
import type { ViewProps } from './types';
import { Button } from '../../ui/Button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const StackedView: React.FC<ViewProps> = ({ books }) => {
    const [activeIndex, setActiveIndex] = useState(0);

    const handleNext = () => {
        setActiveIndex((prev) => (prev + 1) % books.length);
    };

    const handlePrev = () => {
        setActiveIndex((prev) => (prev - 1 + books.length) % books.length);
    };

    if (books.length === 0) return null;

    // We show a stack of 3 books: current, next, next+1
    const visibleCount = 3;
    const stackItems = [];
    for (let i = 0; i < Math.min(visibleCount, books.length); i++) {
        const index = (activeIndex + i) % books.length;
        stackItems.push({ book: books[index], offset: i });
    }
    // Reverse so the last one (bottom of stack) is rendered first
    stackItems.reverse();

    return (
        <div className="flex flex-col items-center justify-center h-full pb-20 overflow-hidden relative">
             <div className="relative w-64 h-96">
                 {stackItems.map(({ book, offset }) => (
                     <div
                        key={`${book.id}-${offset}`} // force re-render for animation if needed, or use book.id
                        className="absolute inset-0 transition-all duration-500 ease-in-out bg-background rounded-xl shadow-2xl border border-border"
                        style={{
                            zIndex: 10 - offset,
                            transform: `translate(${offset * 10}px, ${offset * -10}px) scale(${1 - offset * 0.05})`,
                            opacity: 1 - offset * 0.1
                        }}
                     >
                         <ModernCardView book={book} style={{ width: '100%', height: '100%' }} />
                     </div>
                 ))}
             </div>

             <div className="mt-12 flex items-center gap-4 z-20">
                 <Button variant="outline" size="icon" onClick={handlePrev} disabled={books.length <= 1}>
                     <ChevronLeft className="w-4 h-4" />
                 </Button>
                 <span className="text-sm text-muted-foreground font-medium">
                     {activeIndex + 1} / {books.length}
                 </span>
                 <Button variant="outline" size="icon" onClick={handleNext} disabled={books.length <= 1}>
                     <ChevronRight className="w-4 h-4" />
                 </Button>
             </div>

             <p className="mt-4 text-xs text-muted-foreground text-center max-w-xs">
                 Swipe or use arrows to browse the stack.
             </p>
        </div>
    );
};
