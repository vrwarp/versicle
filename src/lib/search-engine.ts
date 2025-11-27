import FlexSearch from 'flexsearch';

export interface SearchResult {
    href: string;
    excerpt: string;
}

export class SearchEngine {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private indexes = new Map<string, any>();

    indexBook(bookId: string, sections: { id: string; href: string; text: string }[]) {
        // @ts-expect-error FlexSearch types might be missing or different
        const index = new FlexSearch.Document({
            id: "id",
            index: ["text"],
            store: ["href", "text"]
        });

        sections.forEach(section => {
            index.add({
                id: section.href,
                text: section.text,
                href: section.href
            });
        });

        this.indexes.set(bookId, index);
    }

    search(bookId: string, query: string): SearchResult[] {
        const index = this.indexes.get(bookId);
        if (!index) return [];

        const results = index.search(query, {
            enrich: true,
            limit: 50
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return results.flatMap((entry: any) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            entry.result.map((match: any) => ({
                href: match.doc.href,
                excerpt: this.getExcerpt(match.doc.text, query)
            }))
        );
    }

    private getExcerpt(text: string, query: string): string {
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const index = lowerText.indexOf(lowerQuery);

        if (index === -1) return text.substring(0, 100) + '...';

        const start = Math.max(0, index - 40);
        const end = Math.min(text.length, index + query.length + 40);

        return (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
    }
}
