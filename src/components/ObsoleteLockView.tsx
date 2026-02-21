import React from 'react';
import { useUIStore } from '../store/useUIStore';
import { CURRENT_SCHEMA_VERSION } from '../store/yjs-provider';

/**
 * Non-dismissible full-screen overlay when the app detects a newer
 * Yjs schema version from the cloud than it can support.
 *
 * This prevents a stale client from overwriting migrated data.
 * The user must update the app to continue.
 */
export const ObsoleteLockView: React.FC = () => {
    const obsoleteLock = useUIStore(state => state.obsoleteLock);

    if (!obsoleteLock) return null;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 99999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'var(--background, #111)',
                color: 'var(--foreground, #eee)',
                padding: '2rem',
            }}
        >
            <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem' }}>
                    Update Required
                </h1>
                <p style={{ fontSize: '1rem', opacity: 0.8, marginBottom: '1.5rem', lineHeight: 1.5 }}>
                    Your data has been upgraded to a newer format by another device.
                    This version of Versicle (schema v{CURRENT_SCHEMA_VERSION}) cannot safely
                    read or write the new format.
                </p>
                <p style={{ fontSize: '0.875rem', opacity: 0.6, lineHeight: 1.5 }}>
                    Please update the app to the latest version, then reload this page.
                    Your data is safe — this lock prevents any accidental overwrites.
                </p>
                <button
                    onClick={() => window.location.reload()}
                    style={{
                        marginTop: '2rem',
                        padding: '0.75rem 1.5rem',
                        borderRadius: '0.5rem',
                        border: 'none',
                        backgroundColor: 'var(--primary, #3b82f6)',
                        color: 'var(--primary-foreground, #fff)',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                    }}
                >
                    Reload After Updating
                </button>
            </div>
        </div>
    );
};
