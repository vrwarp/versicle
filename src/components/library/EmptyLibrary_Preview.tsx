import React from 'react';
import { EmptyLibrary } from './EmptyLibrary';
import { createRoot } from 'react-dom/client';
import '../../index.css'; // Make sure styles are loaded if possible, otherwise UI will be bare

export const Preview = () => (
    <div style={{ padding: '20px' }}>
        <EmptyLibrary onImport={() => console.log('Import clicked')} />
    </div>
);

// We won't render directly unless needed
