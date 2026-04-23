import { useState, useEffect, useCallback, useRef } from 'react';
import { DriveService, type DriveFile } from '../../lib/drive/DriveService';

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
            const files = await DriveService.listFolders(folderId);
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

    const navigateUp = () => {
        if (breadcrumbs.length <= 1) return;

        const newBreadcrumbs = [...breadcrumbs];
        newBreadcrumbs.pop(); // Remove current
        const parent = newBreadcrumbs[newBreadcrumbs.length - 1];

        setBreadcrumbs(newBreadcrumbs);
        setCurrentFolderId(parent.id);
    };

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
        refresh
    };
};
