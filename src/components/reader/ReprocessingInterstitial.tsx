import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { dbService } from '../../db/DBService';
import { extractContentOffscreen } from '../../lib/offscreen-renderer';
import type { TableImage } from '../../types/db';
import { getDB } from '../../db/db';

interface ReprocessingInterstitialProps {
  bookId: string;
  onComplete: () => void;
}

export const ReprocessingInterstitial: React.FC<ReprocessingInterstitialProps> = ({ bookId, onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Initializing...');

  useEffect(() => {
    let isCancelled = false;

    const process = async () => {
      try {
        // Fetch file directly from the files store (via DBService helper if available, or raw DB)
        const fileData = await dbService.getBookFile(bookId);

        if (!fileData) {
            // If file is missing (e.g. offloaded book), we can't process tables.
            // Mark as processed to avoid infinite loop of trying.
            const db = await getDB();
            const tx = db.transaction('books', 'readwrite');
            const bookStore = tx.objectStore('books');
            const book = await bookStore.get(bookId);
            if (book) {
                book.tablesProcessed = true;
                await bookStore.put(book);
            }
            await tx.done;
            if (!isCancelled) onComplete();
            return;
        }

        const file = fileData instanceof Blob ? fileData : new Blob([fileData]);

        // Process only for tables (though extractContentOffscreen does full pass, we just need tables)
        // We can ignore the text extraction parts if we wanted to optimize, but offscreen-renderer does both.
        // For now, we reuse the existing function.

        setStatus('Scanning for complex tables...');
        const chapters = await extractContentOffscreen(file, {}, (p, msg) => {
            if (!isCancelled) {
                setProgress(p);
                setStatus(msg);
            }
        });

        if (isCancelled) return;

        setStatus('Saving enhancements...');

        const tableImages: TableImage[] = [];
        chapters.forEach((chapter) => {
             if (chapter.tables) {
                 chapter.tables.forEach((table) => {
                     tableImages.push({
                         id: `${bookId}-${table.cfi}`,
                         bookId,
                         sectionId: chapter.href,
                         cfi: table.cfi,
                         imageBlob: table.imageBlob
                     });
                 });
             }
        });

        // Batch save
        const db = await getDB();
        const tx = db.transaction(['books', 'table_images'], 'readwrite');

        // Update Metadata
        const bookStore = tx.objectStore('books');
        const book = await bookStore.get(bookId);
        if (book) {
            book.tablesProcessed = true;
            await bookStore.put(book);
        }

        // Store Images
        const tableStore = tx.objectStore('table_images');
        for (const img of tableImages) {
            await tableStore.put(img);
        }

        await tx.done;

        if (!isCancelled) {
            onComplete();
        }

      } catch (err) {
        console.error('Reprocessing failed', err);
        // On error, we might just want to let the user proceed without tables?
        // Or show an error state. For now, proceeding is safer to avoid lockout.
        onComplete();
      }
    };

    process();

    return () => {
      isCancelled = true;
    };
  }, [bookId, onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/90 dark:bg-zinc-950/90 backdrop-blur-sm">
      <div className="w-full max-w-md p-6 bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-800 text-center space-y-6">

        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Enhancing Book Layout
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Generating optimized images for complex tables. This only happens once per book.
          </p>
        </div>

        <div className="relative flex items-center justify-center py-8">
             <div className="absolute inset-0 flex items-center justify-center">
                 <Loader2 className="w-16 h-16 text-blue-500 animate-spin opacity-20" />
             </div>
             <div className="text-3xl font-bold font-mono text-zinc-700 dark:text-zinc-300">
                 {progress}%
             </div>
        </div>

        <p className="text-xs font-mono text-zinc-400 dark:text-zinc-500 animate-pulse">
            {status}
        </p>
      </div>
    </div>
  );
};
