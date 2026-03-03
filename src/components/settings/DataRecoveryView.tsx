import React, { useState } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Button } from '../ui/Button';
import { createLogger } from '../../lib/logger';
import { Download, RefreshCw, AlertCircle } from 'lucide-react';
import { exportFile } from '../../lib/export';

const logger = createLogger('DataRecoveryView');

export const DataRecoveryView: React.FC = () => {
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rawData, setRawData] = useState<Record<string, any> | null>(null);

    const loadData = async () => {
        setStatus('loading');
        setErrorMsg(null);
        setRawData(null);

        try {
            // Create isolated Y.Doc and Persistence
            const tempDoc = new Y.Doc();
            const tempPersistence = new IndexeddbPersistence('versicle-yjs', tempDoc);

            await new Promise<void>((resolve, reject) => {
                const timeoutTimer = setTimeout(() => {
                    reject(new Error("Timeout waiting for IndexedDB to sync."));
                }, 10000);

                tempPersistence.once('synced', () => {
                    clearTimeout(timeoutTimer);
                    resolve();
                });
            });

            // Extract all root types (assuming maps and arrays)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const extractedData: Record<string, any> = {};

            // To get all root level shared types in a Y.Doc, we can iterate over doc.share
            for (const [key, type] of tempDoc.share.entries()) {
                if (type instanceof Y.AbstractType) {
                    extractedData[key] = type.toJSON();
                }
            }

            // Also try to get known keys if doc.share doesn't iterate perfectly
            const knownKeys = ['library', 'readingState', 'preferences', 'readerUI', 'readingList', 'tts', 'devices', 'genai', 'backNavigation'];
            for (const key of knownKeys) {
                if (!extractedData[key]) {
                    extractedData[key] = tempDoc.getMap(key).toJSON();
                }
            }

            setRawData(extractedData);
            setStatus('success');

            // Cleanup
            tempPersistence.destroy();
            tempDoc.destroy();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            logger.error('Failed to load raw Yjs data for recovery', err);
            setErrorMsg(err.message || 'Unknown error occurred.');
            setStatus('error');
        }
    };

    const handleDownload = async () => {
        if (!rawData) return;
        try {
            const jsonString = JSON.stringify(rawData, null, 2);
            const filename = `versicle_raw_yjs_recovery_${new Date().toISOString().split('T')[0]}.json`;

            await exportFile({
                filename,
                data: jsonString,
                mimeType: 'application/json'
            });
        } catch (e) {
            logger.error('Failed to download raw data', e);
            alert('Failed to download data.');
        }
    };

    return (
        <div className="flex flex-col h-full bg-background rounded-md border p-4 space-y-4">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-semibold">Raw Data Recovery</h2>
                    <p className="text-sm text-muted-foreground">
                        Extract your raw synchronized data directly from the local database.
                        This can be used if the application state is corrupted.
                    </p>
                </div>
                <div className="flex space-x-2">
                    <Button onClick={loadData} disabled={status === 'loading'} size="sm" variant="outline">
                        <RefreshCw className={`h-4 w-4 mr-2 ${status === 'loading' ? 'animate-spin' : ''}`} />
                        {status === 'success' ? 'Reload Data' : 'Load Data'}
                    </Button>
                    <Button onClick={handleDownload} disabled={!rawData} size="sm">
                        <Download className="h-4 w-4 mr-2" />
                        Download JSON
                    </Button>
                </div>
            </div>

            {status === 'error' && (
                <div className="bg-destructive/10 text-destructive p-4 rounded-md flex items-center space-x-3">
                    <AlertCircle className="h-5 w-5" />
                    <div>
                        <h4 className="font-semibold">Failed to read database</h4>
                        <p className="text-sm mt-1">{errorMsg}</p>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-auto border rounded-md bg-muted/30 p-4">
                {status === 'idle' ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground flex-col space-y-2">
                        <p>Click "Load Data" to read the local IndexedDB database.</p>
                        <p className="text-xs">This operation connects directly to the 'versicle-yjs' IndexedDB store.</p>
                    </div>
                ) : status === 'loading' ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                        <RefreshCw className="h-6 w-6 animate-spin" />
                    </div>
                ) : rawData ? (
                    <pre className="text-xs font-mono overflow-auto whitespace-pre-wrap">
                        {JSON.stringify(rawData, null, 2)}
                    </pre>
                ) : null}
            </div>
        </div>
    );
};
