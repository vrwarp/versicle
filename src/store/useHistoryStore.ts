import { create } from 'zustand';
import * as Y from 'yjs';
import { yDoc } from './yjs-provider';
import { createLogger } from '../lib/logger';

const logger = createLogger('HistoryStore');

// StackItem is not exported from Yjs public API, so we extract it from UndoManager
type StackItem = InstanceType<typeof Y.UndoManager>['undoStack'][number];

export interface HistoryItem {
    timestamp: number;
    description: string;
    // We don't expose the raw StackItem to the UI, just metadata
}

interface HistoryState {
    history: HistoryItem[];
    future: HistoryItem[];
    undo: () => void;
    redo: () => void;
    // Advanced: Undo multiple steps (to a specific point)
    undoTo: (index: number) => void;
}

// Create a singleton UndoManager for the shared types we want to track
const trackedTypes = [
    yDoc.getMap('library'),
    yDoc.getMap('progress'),
    yDoc.getMap('annotations'),
    yDoc.getMap('reading-list')
];

// Initialize UndoManager
// captureTimeout: 500ms (default) - groups changes happening within 500ms into one undo step
export const undoManager = new Y.UndoManager(trackedTypes, {
    captureTimeout: 500
});

// Helper to infer description from StackItem
const inferDescription = (item: StackItem): string => {
    let desc = 'Update';

    if (item.meta.has('description')) {
        return item.meta.get('description') as string;
    }

    return desc;
};

// Helper to format HistoryItem
const formatStackItem = (item: StackItem): HistoryItem => {
    return {
        timestamp: item.meta.get('timestamp') as number || Date.now(),
        description: inferDescription(item)
    };
};

function updateStore() {
    // Map stack items to HistoryItems
    // undoStack: Oldest -> Newest (so index 0 is oldest)
    // We want the UI to show Newest -> Oldest.
    // So we reverse the mapped array.

    const history = undoManager.undoStack.map(formatStackItem).reverse();
    const future = undoManager.redoStack.map(formatStackItem).reverse();

    useHistoryStore.setState({
        history,
        future
    });
}

export const useHistoryStore = create<HistoryState>(() => ({
    history: [],
    future: [],

    undo: () => {
        undoManager.undo();
    },

    redo: () => {
        undoManager.redo();
    },

    undoTo: (index: number) => {
        // Undo 'index + 1' times (since index 0 is the latest)
        if (index < 0) return;

        logger.info(`Undoing ${index + 1} steps...`);
        // We iterate and undo one by one.
        // Note: undoManager.undo() pops from stack, so the next one becomes the top.
        for (let i = 0; i <= index; i++) {
            undoManager.undo();
        }
    }
}));

let isInitialized = false;

// Initialize listeners
export const initHistory = () => {
    if (isInitialized) return;
    isInitialized = true;

    logger.info('Initializing History Store (UndoManager)...');

    undoManager.on('stack-item-added', (event: { stackItem: StackItem, type: 'undo' | 'redo' }) => {
        // Add timestamp if missing
        if (!event.stackItem.meta.has('timestamp')) {
            event.stackItem.meta.set('timestamp', Date.now());
        }

        // Enforce 100 item limit on the undoStack
        // undoStack is Oldest -> Newest. If we have > 100, remove the oldest (index 0).
        if (undoManager.undoStack.length > 100) {
            undoManager.undoStack.splice(0, undoManager.undoStack.length - 100);
        }

        // Sync store
        updateStore();
    });

    undoManager.on('stack-item-popped', () => {
        updateStore();
    });

    // Initial sync
    updateStore();
};
