import { useState, useEffect } from 'react';

/**
 * Hook to create and manage an Object URL for a Blob.
 * @param blob The Blob object.
 * @returns The Object URL, or null if the blob is null.
 */
export function useObjectUrl(blob: Blob | undefined | null): string | null {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!blob) {
            setUrl(null); // eslint-disable-line react-hooks/set-state-in-effect
            return;
        }

        const objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);

        return () => {
            URL.revokeObjectURL(objectUrl);
        };
    }, [blob]);

    return url;
}
