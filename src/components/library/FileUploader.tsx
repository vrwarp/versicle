import React, { useCallback, useState } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';

export const FileUploader: React.FC = () => {
  const { addBook, isImporting } = useLibraryStore();
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.name.endsWith('.epub')) {
          addBook(file);
        } else {
            alert("Only .epub files are supported");
        }
      }
    },
    [addBook]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      addBook(e.target.files[0]);
    }
  };

  return (
    <div
      className={`relative w-full border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
        dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
      }`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input
        type="file"
        id="file-upload"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        onChange={handleChange}
        accept=".epub"
        disabled={isImporting}
      />

      {isImporting ? (
        <div className="flex flex-col items-center justify-center space-y-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <p className="text-gray-600">Importing book...</p>
        </div>
      ) : (
        <div className="space-y-2">
            <p className="text-lg font-medium text-gray-700">
                Drop your EPUB here, or <span className="text-blue-500">browse</span>
            </p>
             <p className="text-sm text-gray-500">
                Supports .epub files
             </p>
        </div>
      )}
    </div>
  );
};
