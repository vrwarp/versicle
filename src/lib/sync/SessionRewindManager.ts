import * as Y from 'yjs';
import { yDoc } from '../../store/yjs-provider';
import { createLogger } from '../logger';

const logger = createLogger('SessionRewindManager');

export interface TimeMachineSnapshot {
    id: string;
    timestamp: number;
    snapshot: Y.Snapshot;
    trigger: 'action' | 'auto' | 'manual';
    description: string;
}

// Deep apply logic to avoid relying on undocumented middleware exports
// This recursively updates a Y.Map to match a plain JS object, removing keys that don't exist
// and deep-copying objects and arrays into Y.Map and Y.Array instances.
function applyJSONToMap(yMap: Y.Map<any>, json: any) {
    if (!json || typeof json !== 'object') return;

    // Remove keys that are not in json
    const jsonKeys = new Set(Object.keys(json));
    for (const key of yMap.keys()) {
        if (!jsonKeys.has(key)) {
            yMap.delete(key);
        }
    }

    // Insert or update keys
    for (const [key, value] of Object.entries(json)) {
        if (value === null || value === undefined) {
            yMap.set(key, value);
        } else if (Array.isArray(value)) {
            let yArr = yMap.get(key);
            if (!(yArr instanceof Y.Array)) {
                yArr = new Y.Array();
                yMap.set(key, yArr);
            }
            applyJSONToArray(yArr, value);
        } else if (typeof value === 'object') {
            let childMap = yMap.get(key);
            if (!(childMap instanceof Y.Map)) {
                childMap = new Y.Map();
                yMap.set(key, childMap);
            }
            applyJSONToMap(childMap, value);
        } else {
            // primitive value
            yMap.set(key, value);
        }
    }
}

function applyJSONToArray(yArr: Y.Array<any>, jsonArr: any[]) {
    // The simplest way to handle arrays in this context is to clear and push
    // since deep diffing arrays without IDs is complex and these arrays are usually small tags/ranges
    yArr.delete(0, yArr.length);

    const elements = jsonArr.map(value => {
        if (value === null || value === undefined) {
            return value;
        } else if (Array.isArray(value)) {
            const childArr = new Y.Array();
            applyJSONToArray(childArr, value);
            return childArr;
        } else if (typeof value === 'object') {
            const childMap = new Y.Map();
            applyJSONToMap(childMap, value);
            return childMap;
        } else {
            return value;
        }
    });

    if (elements.length > 0) {
        yArr.push(elements);
    }
}


export class SessionRewindManager {
    private snapshots: TimeMachineSnapshot[] = [];
    private readonly MAX_SNAPSHOTS = 50;
    private isRestoring = false;

    // We store the initial state as well to allow undoing the very first action
    private initialSnapshot: Y.Snapshot | null = null;
    private unsubscribeFn: (() => void) | null = null;

    constructor() {
        // Will initialize later
    }

    public startTracking() {
        if (this.unsubscribeFn) return;

        logger.info('Starting tracking for SessionRewindManager...');
        this.initialSnapshot = Y.snapshot(yDoc);

        const handleUpdate = (update: Uint8Array, origin: any, doc: Y.Doc, transaction: Y.Transaction) => {
            // Do not capture our own rewind operations or sync updates (like from firestore or indexeddb)
            if (this.isRestoring) return;

            // For now, capture local API transactions
            // 'api' origins come from zustand-middleware-yjs
            // or 'session-rewind'
            if (origin && typeof origin === 'object' && origin.constructor === Object) {
                // Determine which top-level type was changed
                const trackedKeys = ['library', 'progress', 'annotations', 'reading-list'];
                let changedTracker = false;

                for (const key of trackedKeys) {
                    if (transaction.changedParentTypes.has(yDoc.getMap(key))) {
                        changedTracker = true;
                        break;
                    }

                    // check if any of the changed types are children of the tracked maps
                    const rootMap = yDoc.getMap(key);
                    for (const changedType of transaction.changedParentTypes.keys()) {
                        let parent = changedType;
                        while (parent && parent !== yDoc) {
                            if (parent === rootMap) {
                                changedTracker = true;
                                break;
                            }
                            parent = parent.parent as Y.AbstractType<any>;
                        }
                        if (changedTracker) break;
                    }
                    if (changedTracker) break;
                }

                if (changedTracker) {
                    this.capture('auto', 'Update');
                }
            }
        };

        yDoc.on('update', handleUpdate);

        this.unsubscribeFn = () => {
            yDoc.off('update', handleUpdate);
        };
    }

    public stopTracking() {
        if (this.unsubscribeFn) {
            this.unsubscribeFn();
            this.unsubscribeFn = null;
        }
    }

    public capture(trigger: TimeMachineSnapshot['trigger'] = 'auto', description = 'Update'): string | null {
        if (this.isRestoring) return null;

        const id = crypto.randomUUID();
        this.snapshots.push({
            id,
            timestamp: Date.now(),
            snapshot: Y.snapshot(yDoc), // Captures vector clock, O(1) memory
            trigger,
            description
        });

        if (this.snapshots.length > this.MAX_SNAPSHOTS) {
            this.snapshots.shift();
        }

        logger.debug(`Captured snapshot ${id} (${trigger})`);
        // We might want to notify listeners
        this.notifyListeners();

        return id;
    }

    private listeners = new Set<() => void>();

    public subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notifyListeners() {
        for (const listener of this.listeners) {
            listener();
        }
    }

    public getHistory(): TimeMachineSnapshot[] {
        return [...this.snapshots].reverse();
    }

    public createPreviewDoc(snapshotId: string | 'initial'): Y.Doc {
        let snap: Y.Snapshot;
        if (snapshotId === 'initial') {
            if (!this.initialSnapshot) throw new Error('Initial snapshot not found');
            snap = this.initialSnapshot;
        } else {
            const record = this.snapshots.find(s => s.id === snapshotId);
            if (!record) throw new Error('Snapshot not found');
            snap = record.snapshot;
        }

        // Clones the active state up to the specific vector clock
        return Y.createDocFromSnapshot(yDoc, snap);
    }

    public restore(snapshotId: string | 'initial'): void {
        logger.info(`Restoring to snapshot: ${snapshotId}`);

        let pastDoc: Y.Doc;
        try {
            pastDoc = this.createPreviewDoc(snapshotId);
        } catch (e) {
            logger.error(`Failed to create preview doc:`, e);
            return;
        }

        this.isRestoring = true;
        try {
            yDoc.transact(() => {
                const trackedKeys = ['library', 'progress', 'annotations', 'reading-list'];

                for (const key of trackedKeys) {
                    const activeType = yDoc.getMap(key);
                    const pastType = pastDoc.getMap(key);

                    if (activeType instanceof Y.Map && pastType instanceof Y.Map) {
                        const pastJSON = pastType.toJSON();
                        applyJSONToMap(activeType, pastJSON);
                    }
                }
            }, 'session-rewind');

            // Adjust the timeline - we don't throw away history on undo usually,
            // but for a strict 'Time Machine' we might truncate history.
            if (snapshotId === 'initial') {
                this.snapshots = [];
            } else {
                const index = this.snapshots.findIndex(s => s.id === snapshotId);
                if (index !== -1) {
                    // Truncate future snapshots after this one
                    this.snapshots = this.snapshots.slice(0, index);
                }
            }

            this.notifyListeners();
        } finally {
            this.isRestoring = false;
            pastDoc.destroy(); // Critical for GC
        }
    }

    public reset() {
        this.snapshots = [];
        this.initialSnapshot = Y.snapshot(yDoc);
        this.notifyListeners();
    }
}

export const sessionRewindManager = new SessionRewindManager();
