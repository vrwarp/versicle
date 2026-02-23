import * as Y from 'yjs';
import { yDoc } from '../store/yjs-provider';

// StackItem is not exported from Yjs public API
export type StackItem = InstanceType<typeof Y.UndoManager>['undoStack'][number];

const trackedTypes = [
    yDoc.getMap('library'),
    yDoc.getMap('progress'),
    yDoc.getMap('annotations'),
    yDoc.getMap('reading-list')
];

export const undoManager = new Y.UndoManager(trackedTypes, {
    captureTimeout: 500,
    // Track transactions from store APIs (which are plain Objects)
    trackedOrigins: new Set([null, Object]),
    captureTransaction: () => true
});
