import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeviceList } from './DeviceList';
import { describe, it, expect, vi } from 'vitest';
import type { DeviceInfo } from '../../types/device';

describe('DeviceList', () => {
    const mockOnRename = vi.fn();
    const mockOnDelete = vi.fn();
    const mockOnClone = vi.fn();

    const mockDevices: DeviceInfo[] = [
        {
            id: 'device-1',
            name: 'Current Device',
            platform: 'Desktop',
            browser: 'Chrome',
            model: null,
            userAgent: 'Mozilla/5.0...',
            appVersion: '1.0.0',
            lastActive: Date.now(),
            created: Date.now(),
            profile: {
                theme: 'light',
                fontSize: 16,
                ttsVoiceURI: null,
                ttsRate: 1,
                ttsPitch: 1
            }
        },
        {
            id: 'device-2',
            name: 'Other Device',
            platform: 'Mobile',
            browser: 'Safari',
            model: 'iPhone',
            userAgent: 'Mozilla/5.0...',
            appVersion: '1.0.0',
            lastActive: Date.now() - 3600000,
            created: Date.now(),
            profile: {
                theme: 'dark',
                fontSize: 18,
                ttsVoiceURI: null,
                ttsRate: 1.2,
                ttsPitch: 1
            }
        }
    ];

    it('renders device list correctly', () => {
        render(
            <DeviceList
                devices={mockDevices}
                currentDeviceId="device-1"
                onRename={mockOnRename}
                onDelete={mockOnDelete}
                onClone={mockOnClone}
            />
        );

        expect(screen.getByText('Current Device')).toBeInTheDocument();
        expect(screen.getByText('Other Device')).toBeInTheDocument();
    });

    it('enters edit mode when edit button is clicked', () => {
        render(
            <DeviceList
                devices={mockDevices}
                currentDeviceId="device-1"
                onRename={mockOnRename}
                onDelete={mockOnDelete}
                onClone={mockOnClone}
            />
        );

        // Find the edit button by accessible label (first device)
        const editButtons = screen.getAllByLabelText('Rename device');
        expect(editButtons.length).toBeGreaterThan(0);
        const editButton = editButtons[0];

        // Click it
        fireEvent.click(editButton);

        // Check if input appears with correct accessible label
        const input = screen.getByLabelText('Device name');
        expect(input).toBeInTheDocument();
        expect(input).toHaveValue('Current Device');

        // Check for Save and Cancel buttons by accessible label
        expect(screen.getByLabelText('Save name')).toBeInTheDocument();
        expect(screen.getByLabelText('Cancel editing')).toBeInTheDocument();
    });

    it('displays remove button with accessible label for non-current devices', () => {
        render(
            <DeviceList
                devices={mockDevices}
                currentDeviceId="device-1"
                onRename={mockOnRename}
                onDelete={mockOnDelete}
                onClone={mockOnClone}
            />
        );

        // Remove button should exist for the second device
        const removeButtons = screen.getAllByLabelText('Remove device');
        expect(removeButtons.length).toBeGreaterThan(0);
    });
});
