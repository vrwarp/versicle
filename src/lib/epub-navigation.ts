import type { NavigationItem } from 'epubjs';

/**
 * Flattens the Table of Contents into a single list.
 */
export const flattenToc = (items: NavigationItem[]): NavigationItem[] => {
    return items.reduce((acc, item) => {
        acc.push(item);
        if (item.subitems && item.subitems.length > 0) {
            acc.push(...flattenToc(item.subitems));
        }
        return acc;
    }, [] as NavigationItem[]);
};

/**
 * Finds the nearest chapter in the TOC based on the current spine index.
 * This is useful when the current location (href) is not directly present in the TOC
 * (e.g. hash fragments, or pages between TOC items).
 *
 * @param book The epub.js Book object (typed as any to access internal spine/index properties)
 * @param toc The Table of Contents
 * @param currentSectionId The href/id of the current section
 * @param direction Direction to search ('prev' or 'next')
 */
export const findNearestChapter = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    book: any,
    toc: NavigationItem[],
    currentSectionId: string,
    direction: 'prev' | 'next'
): NavigationItem | null => {
    if (!book || !currentSectionId) return null;

    const flatToc = flattenToc(toc);
    const currentSpineItem = book.spine.get(currentSectionId);

    if (!currentSpineItem) return null;

    const currentSpineIndex = currentSpineItem.index;
    let target: NavigationItem | null = null;

    if (direction === 'next') {
        // Find the first TOC item that comes AFTER the current spine index
        for (const item of flatToc) {
            const itemSpine = book.spine.get(item.href);
            if (itemSpine && itemSpine.index > currentSpineIndex) {
                target = item;
                break;
            }
        }

        // Edge case: If no next chapter found, but we are at the very beginning (e.g. cover)
        // and the first chapter is after us.
        if (!target && flatToc.length > 0) {
             const firstItemSpine = book.spine.get(flatToc[0].href);
             // If the first item in TOC is after the current position, it's the next chapter.
             if (firstItemSpine && firstItemSpine.index > currentSpineIndex) {
                 target = flatToc[0];
             }
        }
    } else {
        // Find the last TOC item that comes BEFORE the current spine index
        for (let i = flatToc.length - 1; i >= 0; i--) {
            const item = flatToc[i];
            const itemSpine = book.spine.get(item.href);
            if (itemSpine && itemSpine.index < currentSpineIndex) {
                target = item;
                break;
            }
        }
    }

    return target;
};
