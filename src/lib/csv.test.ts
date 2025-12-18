import { describe, it, expect } from 'vitest';
import { exportReadingListToCSV, parseReadingListCSV } from './csv';
import type { ReadingListEntry } from '../types/db';

describe('CSV Util', () => {
    const entries: ReadingListEntry[] = [
        {
            filename: 'book1.epub',
            title: 'Book One',
            author: 'Author One',
            isbn: '1234567890',
            percentage: 0.5,
            lastUpdated: 1672531200000, // 2023-01-01
            status: 'currently-reading',
            rating: 4
        },
        {
            filename: 'book2.epub',
            title: 'Book Two, The Sequel',
            author: 'Author Two',
            percentage: 1.0,
            lastUpdated: 1672617600000, // 2023-01-02
            status: 'read'
        }
    ];

    it('exports correctly', () => {
        const csv = exportReadingListToCSV(entries);
        expect(csv).toContain('Book One');
        expect(csv).toContain('"Book Two, The Sequel"');
        expect(csv).toContain('book1.epub');
        expect(csv).toContain('0.5000');
    });

    it('imports correctly', () => {
        const csv = exportReadingListToCSV(entries);
        const imported = parseReadingListCSV(csv);

        expect(imported.length).toBe(2);
        expect(imported[0].title).toBe('Book One');
        expect(imported[1].title).toBe('Book Two, The Sequel');
        expect(imported[0].filename).toBe('book1.epub');
        expect(imported[0].percentage).toBeCloseTo(0.5);
        expect(imported[1].status).toBe('read');
    });

    it('imports Goodreads style CSV', () => {
        const gdCsv = `Title,Author,ISBN,My Rating,Average Rating,Publisher,Binding,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies
"Ender's Game","Orson Scott Card","0812550706","5","4.30","Tor Science Fiction","Mass Market Paperback","1994","1985","2013/05/25","2013/05/20","read","read (#5)","read","","","","1","0"`;

        const imported = parseReadingListCSV(gdCsv);
        expect(imported.length).toBe(1);
        expect(imported[0].title).toBe("Ender's Game");
        expect(imported[0].author).toBe("Orson Scott Card");
        expect(imported[0].isbn).toBe("0812550706");
        expect(imported[0].status).toBe('read');
        expect(imported[0].percentage).toBe(1.0);
        // Filename should be generated from ISBN or title-author
        expect(imported[0].filename).toBe('isbn-0812550706');
    });
});
