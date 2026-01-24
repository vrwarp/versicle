import React from 'react';
import { useSyncToasts } from '../../lib/sync/hooks/useSyncToasts';

/**
 * Headless component that activates sync toast notifications.
 * Should be mounted once at the root of the app.
 */
export const SyncToastPropagator: React.FC = () => {
    useSyncToasts();
    return null;
};
