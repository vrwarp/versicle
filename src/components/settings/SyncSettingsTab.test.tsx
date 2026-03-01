import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SyncSettingsTab, SyncSettingsTabProps } from './SyncSettingsTab';

// Mock UI components
vi.mock('../ui/Select', () => ({
    Select: ({ children, value }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void }) => (
        <div data-testid="select" data-value={value}>{children}</div>
    ),
    SelectTrigger: ({ children, id }: { children: React.ReactNode; id?: string }) => <button id={id}>{children}</button>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
        <div data-testid={`select-item-${value}`}>{children}</div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>
}));

// Mock Google Services Store
const mockSetGoogleClientId = vi.fn();
const mockSetGoogleIosClientId = vi.fn();

vi.mock('../../store/useGoogleServicesStore', () => ({
    useGoogleServicesStore: Object.assign(
        () => ({
            isServiceConnected: vi.fn().mockReturnValue(false),
            googleClientId: 'mock-web-id',
            googleIosClientId: 'mock-ios-id',
        }),
        {
            getState: () => ({
                setGoogleClientId: mockSetGoogleClientId,
                setGoogleIosClientId: mockSetGoogleIosClientId,
                googleClientId: 'mock-web-id',
                googleIosClientId: 'mock-ios-id',
                // Mock other used actions if necessary
                connectService: vi.fn(),
                disconnectService: vi.fn(),
                isServiceConnected: vi.fn().mockReturnValue(false),
            }),
        }
    ),
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

        expect(screen.getByText('App Sync')).toBeInTheDocument();
    });

    it('renders device identity section', () => {
        render(<SyncSettingsTab {...defaultProps} />);

        expect(screen.getByText('Device Identity')).toBeInTheDocument();
        expect(screen.getByLabelText('Device Name')).toHaveValue('My Device');
        expect(screen.getByText('ID: device-123')).toBeInTheDocument();
    });

    it('shows Save and Cancel buttons when device name is changed, and calls onDeviceRename on Save', () => {
        const onDeviceRename = vi.fn();
        render(<SyncSettingsTab {...defaultProps} onDeviceRename={onDeviceRename} />);

        const input = screen.getByLabelText('Device Name');
        fireEvent.change(input, { target: { value: 'New Name' } });

        // Buttons should appear
        const saveButton = screen.getByText('Save');
        const cancelButton = screen.getByText('Cancel');
        expect(saveButton).toBeInTheDocument();
        expect(cancelButton).toBeInTheDocument();

        // Callback shouldn't be called yet
        expect(onDeviceRename).not.toHaveBeenCalled();

        // Click Save
        fireEvent.click(saveButton);
        expect(onDeviceRename).toHaveBeenCalledWith('New Name');
    });

    it('reverts device name when Cancel is clicked', () => {
        const onDeviceRename = vi.fn();
        render(<SyncSettingsTab {...defaultProps} onDeviceRename={onDeviceRename} />);

        const input = screen.getByLabelText('Device Name');
        fireEvent.change(input, { target: { value: 'New Name' } });

        // Click Cancel
        const cancelButton = screen.getByText('Cancel');
        fireEvent.click(cancelButton);

        // Value should be reverted
        expect(input).toHaveValue('My Device');

        // Buttons should disappear
        expect(screen.queryByText('Save')).not.toBeInTheDocument();
        expect(screen.queryByText('Cancel')).not.toBeInTheDocument();

        // Callback should not be called
        expect(onDeviceRename).not.toHaveBeenCalled();
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
    it('updates Google Client IDs', () => {
        render(<SyncSettingsTab {...defaultProps} syncProvider="none" />);

        const webInput = screen.getByLabelText('Web Client ID');
        fireEvent.change(webInput, { target: { value: 'new-web-id' } });
        expect(mockSetGoogleClientId).toHaveBeenCalledWith('new-web-id');

        const iosInput = screen.getByLabelText('iOS Client ID');
        fireEvent.change(iosInput, { target: { value: 'new-ios-id' } });
        expect(mockSetGoogleIosClientId).toHaveBeenCalledWith('new-ios-id');
    });
});
