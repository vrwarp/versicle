import { create } from 'zustand';
import { sessionRewindManager } from '../lib/sync/SessionRewindManager';
import { createLogger } from '../lib/logger';

const logger = createLogger('HistoryStore');

export interface HistoryItem {
    id: string;
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

function updateStore() {
    const snapshots = sessionRewindManager.getHistory();
    const history = snapshots.map(s => ({
        id: s.id,
        timestamp: s.timestamp,
        description: s.description
    }));

    useHistoryStore.setState({
        history,
        future: [] // Redo is not currently supported in SessionRewindManager
    });
}

export const useHistoryStore = create<HistoryState>(() => ({
    history: [],
    future: [],

    undo: () => {
        const history = sessionRewindManager.getHistory();
        if (history.length === 0) return;

        if (history.length === 1) {
            sessionRewindManager.restore('initial');
        } else {
            // Restore to the snapshot BEFORE the most recent one
            sessionRewindManager.restore(history[1].id);
        }
    },

    redo: () => {
        // Redo is not currently supported
    },

    undoTo: (index: number) => {
        if (index < 0) return;

        logger.info(`Undoing ${index + 1} steps...`);
        const history = sessionRewindManager.getHistory();

        // If we want to undo 'index' items, we go to the item at index + 1 in the history array
        // (history array is reversed, most recent first)
        const targetIndex = index + 1;
        if (targetIndex >= history.length) {
            sessionRewindManager.restore('initial');
        } else {
            sessionRewindManager.restore(history[targetIndex].id);
        }
    }
}));

let isInitialized = false;

// Initialize listeners
export const initHistory = () => {
    if (isInitialized) return;
    isInitialized = true;

    logger.info('Initializing History Store (SessionRewindManager)...');

    sessionRewindManager.startTracking();
    sessionRewindManager.subscribe(() => {
        updateStore();
    });

    updateStore();
};
