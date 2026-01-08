import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { dbService } from '../../db/DBService';
import { extractContentOffscreen } from '../../lib/offscreen-renderer';
import type { TableImage, BookSource } from '../../types/db';
import { getDB } from '../../db/db';
import { CURRENT_BOOK_VERSION } from '../../lib/constants';
import { Dialog } from '../ui/Dialog';

interface ReprocessingInterstitialProps {
  isOpen: boolean;
  bookId: string | null;
  onComplete: () => void;
  onClose: () => void;
}

export const ReprocessingInterstitial: React.FC<ReprocessingInterstitialProps> = ({ isOpen, bookId, onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Initializing...');

  useEffect(() => {
    if (!isOpen || !bookId) {
        return;
    }

    const startProcess = async () => {
        setProgress(0);
        setStatus('Initializing...');

        try {
            // Fetch file directly from the files store (via DBService helper if available, or raw DB)
            const fileData = await dbService.getBookFile(bookId);

            if (!fileData) {
                // If file is missing (e.g. offloaded book), we can't process tables.
                // Mark as processed to avoid infinite loop of trying.
                const db = await getDB();
                const tx = db.transaction('book_sources', 'readwrite');
                const sourceStore = tx.objectStore('book_sources');
                // Cast to avoid implicit any if store is not generic enough, but here we know the schema
                const source = await sourceStore.get(bookId);

                if (source) {
                    source.version = CURRENT_BOOK_VERSION;
                    await sourceStore.put(source);
                } else {
                    // Create minimal source record if missing (unlikely)
                    await sourceStore.put({
                        bookId,
                        version: CURRENT_BOOK_VERSION
                    } as BookSource);
                }
                await tx.done;
                onComplete();
                return;
            }

            const file = fileData instanceof Blob ? fileData : new Blob([fileData]);

            setStatus('Scanning for complex tables...');
            const chapters = await extractContentOffscreen(file, {}, (p, msg) => {
                setProgress(p);
                setStatus(msg);
            });

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
            const tx = db.transaction(['book_sources', 'table_images'], 'readwrite');

            // Update Metadata (Source)
            const sourceStore = tx.objectStore('book_sources');
            const source = await sourceStore.get(bookId);
            if (source) {
                source.version = CURRENT_BOOK_VERSION;
                await sourceStore.put(source);
            } else {
                 await sourceStore.put({
                    bookId,
                    version: CURRENT_BOOK_VERSION
                } as BookSource);
            }

            // Store Images
            const tableStore = tx.objectStore('table_images');
            for (const img of tableImages) {
                await tableStore.put(img);
            }

            await tx.done;

            onComplete();

        } catch (err) {
            console.error('Reprocessing failed', err);
            // On error, we might just want to let the user proceed without tables?
            // Or show an error state. For now, proceeding is safer to avoid lockout.
            onComplete();
        }
    };

    startProcess();
  }, [isOpen, bookId, onComplete]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {}} // Disable closing
      title="Optimizing Book Content"
      description="We are updating this book to the latest version. This ensures the best reading experience and only happens once."
      hideCloseButton={true}
    >
      <div className="flex flex-col items-center justify-center py-4 space-y-6">
        <div className="relative flex items-center justify-center py-4">
             <div className="absolute inset-0 flex items-center justify-center">
                 <Loader2 className="w-16 h-16 text-blue-500 animate-spin opacity-20" />
             </div>
             <div className="text-3xl font-bold font-mono text-zinc-700 dark:text-zinc-300">
                 {progress}%
             </div>
        </div>

        <p className="text-xs font-mono text-zinc-400 dark:text-zinc-500 animate-pulse text-center">
            {status}
        </p>
      </div>
    </Dialog>
  );
};
