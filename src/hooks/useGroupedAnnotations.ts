import { useMemo } from 'react';
import { useAnnotationStore } from '../store/useAnnotationStore';
import type { UserAnnotation } from '../types/db';

export interface BookAnnotationGroup {
    bookId: string;
    annotations: UserAnnotation[];
    latestActivity: number;
}

export const useGroupedAnnotations = (searchQuery: string): BookAnnotationGroup[] => {
    const annotations = useAnnotationStore(state => state.annotations);

    return useMemo(() => {
        const query = searchQuery.toLowerCase().trim();
        const grouped = new Map<string, UserAnnotation[]>();

        Object.values(annotations).forEach(ann => {
            // 1. Filter
            if (query &&
                !ann.text.toLowerCase().includes(query) &&
                !(ann.note?.toLowerCase().includes(query))) {
                return;
            }

            // 2. Group by bookId
            if (!grouped.has(ann.bookId)) grouped.set(ann.bookId, []);
            grouped.get(ann.bookId)!.push(ann);
        });

        // 3. Sort intra-group (ascending by created) and inter-group (descending by latest)
        return Array.from(grouped.entries()).map(([bookId, anns]) => {
            const sortedAnns = anns.sort((a, b) => a.created - b.created);
            const latestActivity = Math.max(...sortedAnns.map(a => a.created));
            return { bookId, annotations: sortedAnns, latestActivity };
        }).sort((a, b) => b.latestActivity - a.latestActivity);
    }, [annotations, searchQuery]);
};
