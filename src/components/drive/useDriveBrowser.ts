import { useState, useEffect, useCallback, useRef } from 'react';
import { getDriveClient, type DriveFile } from '@domains/google';

interface Breadcrumb {
    id: string;
    name: string;
}

interface UseDriveBrowserReturn {
    currentFolderId: string;
    breadcrumbs: Breadcrumb[];
    items: DriveFile[];
    isLoading: boolean;
    error: Error | null;
    openFolder: (id: string, name: string) => void;
    navigateUp: () => void;
    /** Jump to the ancestor at `index` in `breadcrumbs`, dropping every level below it. */
    navigateToCrumb: (index: number) => void;
    refresh: () => void;
}

export const useDriveBrowser = (initialFolderId = 'root'): UseDriveBrowserReturn => {
    const [currentFolderId, setCurrentFolderId] = useState(initialFolderId);
    const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ id: 'root', name: 'My Drive' }]);
    const [items, setItems] = useState<DriveFile[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const requestCounter = useRef(0);

    const fetchItems = useCallback(async (folderId: string) => {
        setIsLoading(true);
        setError(null);
        const currentReq = ++requestCounter.current;
        try {
            // User-gesture surface: interactive token acquisition (popup-on-demand).
            const files = await getDriveClient().listFolders(folderId, { interactive: true });
            if (currentReq === requestCounter.current) {
                setItems(files);
            }
        } catch (err) {
            if (currentReq === requestCounter.current) {
                console.error("Failed to list folder contents:", err);
                setError(err instanceof Error ? err : new Error(String(err)));
            }
        } finally {
            if (currentReq === requestCounter.current) {
                setIsLoading(false);
            }
        }
    }, []);

    // Initial load and on folder change
    useEffect(() => {
        fetchItems(currentFolderId);
    }, [currentFolderId, fetchItems]);

    const openFolder = (id: string, name: string) => {
        setBreadcrumbs(prev => [...prev, { id, name }]);
        setCurrentFolderId(id);
    };

    const navigateToCrumb = (index: number) => {
        // Only strict ancestors are valid targets; the last crumb is the current folder.
        if (index < 0 || index >= breadcrumbs.length - 1) return;

        const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
        setBreadcrumbs(newBreadcrumbs);
        setCurrentFolderId(newBreadcrumbs[index].id);
    };

    const navigateUp = () => navigateToCrumb(breadcrumbs.length - 2);

    const refresh = () => {
        fetchItems(currentFolderId);
    };

    return {
        currentFolderId,
        breadcrumbs,
        items,
        isLoading,
        error,
        openFolder,
        navigateUp,
        navigateToCrumb,
        refresh
    };
};
