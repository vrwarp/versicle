import React from 'react';
import { render } from '@testing-library/react';
import { DeviceIcon } from './DeviceIcon';
import { describe, it, expect } from 'vitest';

describe('DeviceIcon', () => {
    it('renders Smartphone icon for mobile platforms', () => {
        const platforms = ['Mobile', 'Phone', 'Android', 'iOS', 'Windows Phone', 'mobile'];
        platforms.forEach(platform => {
            const { container } = render(<DeviceIcon platform={platform} />);
            expect(container.querySelector('.lucide-smartphone')).toBeInTheDocument();
            expect(container.querySelector('.lucide-tablet')).not.toBeInTheDocument();
            expect(container.querySelector('.lucide-monitor')).not.toBeInTheDocument();
        });
    });

    it('renders Tablet icon for tablet platforms', () => {
        const platforms = ['Tablet', 'iPad', 'tablet', 'IPAD'];
        platforms.forEach(platform => {
            const { container } = render(<DeviceIcon platform={platform} />);
            expect(container.querySelector('.lucide-tablet')).toBeInTheDocument();
            expect(container.querySelector('.lucide-smartphone')).not.toBeInTheDocument();
            expect(container.querySelector('.lucide-monitor')).not.toBeInTheDocument();
        });
    });

    it('renders Monitor icon for other platforms', () => {
        const platforms = ['Windows', 'Mac', 'Linux', 'Desktop', 'Unknown', ''];
        platforms.forEach(platform => {
            const { container } = render(<DeviceIcon platform={platform} />);
            expect(container.querySelector('.lucide-monitor')).toBeInTheDocument();
            expect(container.querySelector('.lucide-smartphone')).not.toBeInTheDocument();
            expect(container.querySelector('.lucide-tablet')).not.toBeInTheDocument();
        });
    });

    it('applies className prop correctly', () => {
        const { container } = render(<DeviceIcon platform="Windows" className="test-class-name" />);
        const icon = container.querySelector('.lucide-monitor');
        expect(icon).toHaveClass('test-class-name');
    });

    it('is case-insensitive for platform matching', () => {
        const { container: container1 } = render(<DeviceIcon platform="ANDROID" />);
        expect(container1.querySelector('.lucide-smartphone')).toBeInTheDocument();

        const { container: container2 } = render(<DeviceIcon platform="iPaD" />);
        expect(container2.querySelector('.lucide-tablet')).toBeInTheDocument();

        const { container: container3 } = render(<DeviceIcon platform="wiNdOwS" />);
        expect(container3.querySelector('.lucide-monitor')).toBeInTheDocument();
    });
});
