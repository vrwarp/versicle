import React, { useEffect, useState } from 'react';
import { yDoc, waitForYjsSync, yjsPersistence } from '../../store/yjs-provider';
import { YjsMonitor } from '../../lib/sync/YjsMonitor';


export const YjsTest: React.FC = () => {
    const [stats, setStats] = useState<any>(null);
    const [syncStatus, setSyncStatus] = useState<string>('Checking...');
    const [lastError, setLastError] = useState<string | null>(null);

    useEffect(() => {
        const updateStats = () => {
            setStats(YjsMonitor.getStats());
        };

        yDoc.on('update', updateStats);
        updateStats();

        waitForYjsSync(1000).then(() => {
            setSyncStatus(yjsPersistence?.synced ? 'Synced (IndexedDB)' : 'Memory Only (Persistence Failed/Not Supported)');
        });

        return () => {
            yDoc.off('update', updateStats);
        };
    }, []);

    const writeValidData = () => {
        try {
            yDoc.transact(() => {
                const inventory = yDoc.getMap('inventory');
                inventory.set('test-book-1', {
                    bookId: 'test-book-1',
                    title: 'Valid Book',
                    addedAt: Date.now()
                });
            });
            setLastError(null);
        } catch (e: any) {
            setLastError(e.message);
        }
    };

    const clearData = () => {
        yDoc.transact(() => {
            yDoc.getMap('inventory').clear();
            yDoc.getMap('reading_list').clear();
        });
    };

    return (
        <div className="p-4 border rounded bg-gray-100 dark:bg-gray-800 text-xs font-mono">
            <h3 className="font-bold mb-2">Yjs Debugger</h3>
            <div className="mb-2">Status: <span className={syncStatus.includes('Synced') ? 'text-green-600' : 'text-red-500'}>{syncStatus}</span></div>

            <div className="grid grid-cols-2 gap-2 mb-4">
                <div>Inventory: {stats?.inventoryCount}</div>
                <div>Progress: {stats?.progressCount}</div>
                <div>Doc Size: {stats?.docSizeBytes} bytes</div>
            </div>

            <div className="flex gap-2">
                <button onClick={writeValidData} className="px-2 py-1 bg-blue-500 text-white rounded">Write Test Data</button>
                <button onClick={clearData} className="px-2 py-1 bg-red-500 text-white rounded">Clear Data</button>
            </div>

            {lastError && <div className="mt-2 text-red-600 bg-red-100 p-2 rounded">Error: {lastError}</div>}
        </div>
    );
};
