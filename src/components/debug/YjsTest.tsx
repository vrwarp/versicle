import React, { useEffect, useState } from 'react';
import { yDoc, waitForYjsSync } from '../../store/yjs-provider';

export const YjsTest: React.FC = () => {
    const [value, setValue] = useState<string>('');
    const [status, setStatus] = useState<string>('Syncing...');

    useEffect(() => {
        const init = async () => {
            await waitForYjsSync();
            setStatus('Synced');

            const map = yDoc.getMap('debug');
            const current = map.get('testKey') as string;
            if (current) setValue(current);

            yDoc.on('update', () => {
                const updated = map.get('testKey') as string;
                if (updated) setValue(updated);
            });
        };
        init();
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setValue(val);
        yDoc.getMap('debug').set('testKey', val);
    };

    return (
        <div className="fixed bottom-4 right-4 p-4 bg-gray-800 text-white rounded shadow-lg z-50">
            <h3 className="font-bold mb-2">Yjs Debug ({status})</h3>
            <input
                type="text"
                value={value}
                onChange={handleChange}
                className="text-black px-2 py-1 rounded"
                placeholder="Type to persist..."
            />
        </div>
    );
};
