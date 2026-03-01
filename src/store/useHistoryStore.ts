import { create } from 'zustand';
import { undoManager, type StackItem } from '../lib/undo-manager';
import { createLogger } from '../lib/logger';

const logger = createLogger('HistoryStore');

export interface HistoryItem {
    timestamp: number;
    description: string;
}

interface HistoryState {
    history: HistoryItem[];
    future: HistoryItem[];
    undo: () => void;
    redo: () => void;
    undoTo: (index: number) => void;
}

// Re-export undoManager for consumers
export { undoManager };

// Helper to infer description from StackItem
const inferDescription = (item: StackItem): string => {
    const desc = 'Update';

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
        if (index < 0) return;

        logger.info(`Undoing ${index + 1} steps...`);
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
        if (!event.stackItem.meta.has('timestamp')) {
            event.stackItem.meta.set('timestamp', Date.now());
        }

        if (undoManager.undoStack.length > 100) {
            undoManager.undoStack.splice(0, undoManager.undoStack.length - 100);
        }

        updateStore();
    });

    undoManager.on('stack-item-popped', () => {
        updateStore();
    });

    updateStore();
};
