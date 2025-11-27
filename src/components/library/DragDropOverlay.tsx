import React from 'react';
import { Upload } from 'lucide-react';

interface DragDropOverlayProps {
    isDragging: boolean;
}

export const DragDropOverlay: React.FC<DragDropOverlayProps> = ({ isDragging }) => {
    if (!isDragging) return null;

    return (
        <div className="fixed inset-0 z-50 bg-blue-500/10 backdrop-blur-sm border-4 border-blue-500 border-dashed m-4 rounded-xl flex items-center justify-center pointer-events-none">
             <div className="bg-white p-8 rounded-full shadow-xl animate-bounce">
                 <Upload className="w-12 h-12 text-blue-600" />
             </div>
             <h2 className="absolute mt-32 text-2xl font-bold text-blue-700">Drop EPUB to Import</h2>
        </div>
    );
};
