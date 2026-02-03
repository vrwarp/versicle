import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SyncSettingsTab, SyncSettingsTabProps } from './SyncSettingsTab';

// Mock UI components
vi.mock('../ui/Select', () => ({
    Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void }) => (
        <div data-testid="select" data-value={value}>{children}</div>
    ),
    SelectTrigger: ({ children, id }: { children: React.ReactNode; id?: string }) => <button id={id}>{children}</button>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
        <div data-testid={`select-item-${value}`}>{children}</div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>
}));

describe('SyncSettingsTab', () => {
    const defaultProps: SyncSettingsTabProps = {
        currentDeviceId: 'device-123',
        currentDeviceName: 'My Device',
        onDeviceRename: vi.fn(),
        syncProvider: 'none',
        onSyncProviderChange: vi.fn(),
        isFirebaseAvailable: false,
        firebaseAuthStatus: 'signed-out',
        firestoreStatus: 'disconnected',
        firebaseUserEmail: null,
        isFirebaseSigningIn: false,
        firebaseConfig: {
            apiKey: '',
            authDomain: '',
            projectId: '',
            storageBucket: '',
            messagingSenderId: '',
            appId: ''
        },
        onFirebaseConfigChange: vi.fn(),
        onFirebaseSignIn: vi.fn(),
        onFirebaseSignOut: vi.fn(),
        onClearConfig: vi.fn()
    };

    it('renders cross-device sync header', () => {
        render(<SyncSettingsTab {...defaultProps} />);

        expect(screen.getByText('Cross-Device Sync')).toBeInTheDocument();
    });

    it('renders device identity section', () => {
        render(<SyncSettingsTab {...defaultProps} />);

        expect(screen.getByText('Device Identity')).toBeInTheDocument();
        expect(screen.getByLabelText('Device Name')).toHaveValue('My Device');
        expect(screen.getByText('ID: device-123')).toBeInTheDocument();
    });

    it('calls onDeviceRename when device name changed', () => {
        const onDeviceRename = vi.fn();
        render(<SyncSettingsTab {...defaultProps} onDeviceRename={onDeviceRename} />);

        fireEvent.change(screen.getByLabelText('Device Name'), { target: { value: 'New Name' } });
        expect(onDeviceRename).toHaveBeenCalledWith('New Name');
    });

    it('renders provider selection', () => {
        render(<SyncSettingsTab {...defaultProps} />);

        expect(screen.getByText('Sync Provider')).toBeInTheDocument();
    });

    it('hides Firebase section when provider is none', () => {
        render(<SyncSettingsTab {...defaultProps} syncProvider="none" />);

        expect(screen.queryByText('Firebase Configuration')).not.toBeInTheDocument();
    });

    it('shows Firebase config form when not available', () => {
        render(<SyncSettingsTab {...defaultProps} syncProvider="firebase" isFirebaseAvailable={false} />);

        expect(screen.getByText('Firebase Configuration')).toBeInTheDocument();
        expect(screen.getByTestId('firebase-config-paste')).toBeInTheDocument();
        expect(screen.getByLabelText('API Key')).toBeInTheDocument();
    });

    it('shows sign in button when Firebase available but not signed in', () => {
        render(
            <SyncSettingsTab
                {...defaultProps}
                syncProvider="firebase"
                isFirebaseAvailable={true}
                firebaseAuthStatus="signed-out"
            />
        );

        expect(screen.getByText('Sign in with Google')).toBeInTheDocument();
    });

    it('shows connected state when signed in', () => {
        render(
            <SyncSettingsTab
                {...defaultProps}
                syncProvider="firebase"
                isFirebaseAvailable={true}
                firebaseAuthStatus="signed-in"
                firestoreStatus="connected"
                firebaseUserEmail="user@example.com"
            />
        );

        expect(screen.getByText('✓ Connected')).toBeInTheDocument();
        expect(screen.getByText('Signed in as user@example.com')).toBeInTheDocument();
        expect(screen.getByText('Sign Out')).toBeInTheDocument();
    });

    it('shows signing in state', () => {
        render(
            <SyncSettingsTab
                {...defaultProps}
                syncProvider="firebase"
                isFirebaseAvailable={true}
                firebaseAuthStatus="signed-out"
                isFirebaseSigningIn={true}
            />
        );

        expect(screen.getByText('Signing in...')).toBeInTheDocument();
    });

    it('calls onFirebaseSignIn when sign in clicked', () => {
        const onFirebaseSignIn = vi.fn();
        render(
            <SyncSettingsTab
                {...defaultProps}
                syncProvider="firebase"
                isFirebaseAvailable={true}
                onFirebaseSignIn={onFirebaseSignIn}
            />
        );

        fireEvent.click(screen.getByText('Sign in with Google'));
        expect(onFirebaseSignIn).toHaveBeenCalled();
    });

    it('calls onFirebaseSignOut when sign out clicked', () => {
        const onFirebaseSignOut = vi.fn();
        render(
            <SyncSettingsTab
                {...defaultProps}
                syncProvider="firebase"
                isFirebaseAvailable={true}
                firebaseAuthStatus="signed-in"
                firebaseUserEmail="user@example.com"
                onFirebaseSignOut={onFirebaseSignOut}
            />
        );

        fireEvent.click(screen.getByText('Sign Out'));
        expect(onFirebaseSignOut).toHaveBeenCalled();
    });

    it('calls onFirebaseConfigChange when API key changed', () => {
        const onFirebaseConfigChange = vi.fn();
        render(
            <SyncSettingsTab
                {...defaultProps}
                syncProvider="firebase"
                isFirebaseAvailable={false}
                onFirebaseConfigChange={onFirebaseConfigChange}
            />
        );

        fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'new-key' } });
        expect(onFirebaseConfigChange).toHaveBeenCalledWith({ apiKey: 'new-key' });
    });
});
