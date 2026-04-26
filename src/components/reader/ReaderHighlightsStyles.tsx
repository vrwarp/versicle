import React from 'react';

interface ReaderHighlightsStylesProps {
    currentTheme: string;
}

export const ReaderHighlightsStyles: React.FC<ReaderHighlightsStylesProps> = ({ currentTheme }) => {
    const isDark = currentTheme === 'dark';
    const opacity = isDark ? 0.4 : 0.8;
    const blendMode = isDark ? 'screen' : 'multiply';

    return (
        <>
            {/* Striped highlight pattern */}
            <svg
                xmlns="http://www.w3.org/2000/svg"
                id="epubjs-custom-defs"
                style={{ width: 0, height: 0, position: 'absolute' }}
                aria-hidden="true"
            >
                <defs>
                    <pattern
                        id="striped-highlight"
                        patternUnits="userSpaceOnUse"
                        width="16"
                        height="10"
                        patternTransform="rotate(45)"
                    >
                        <rect width="8" height="10" fill="orange" />
                    </pattern>
                </defs>
            </svg>

            {/* Highlights CSS styles */}
            <style>{`
                .highlight-red { 
                    fill: red; 
                    fill-opacity: ${opacity}; 
                    mix-blend-mode: ${blendMode}; 
                }
                .highlight-green { 
                    fill: green; 
                    fill-opacity: ${opacity}; 
                    mix-blend-mode: ${blendMode}; 
                }
                .highlight-blue { 
                    fill: blue; 
                    fill-opacity: ${opacity}; 
                    mix-blend-mode: ${blendMode}; 
                }
                .highlight-yellow { 
                    fill: yellow; 
                    fill-opacity: ${opacity}; 
                    mix-blend-mode: ${blendMode}; 
                }
                .versicle-audio-bookmark-pending { 
                    fill: url(#striped-highlight); 
                    fill-opacity: ${opacity}; 
                    mix-blend-mode: ${blendMode}; 
                }
            `}</style>
        </>
    );
};
