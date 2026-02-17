import React from 'react';
import { Smartphone, Monitor, Tablet } from 'lucide-react';

interface DeviceIconProps {
  platform: string;
  className?: string;
}

/**
 * Gets the device icon based on platform name.
 *
 * @param platform - The platform name (e.g., 'Android', 'iOS', 'Windows', 'Mac').
 * @param className - Optional CSS classes.
 */
export const DeviceIcon: React.FC<DeviceIconProps> = React.memo(({ platform, className }) => {
  const lower = platform.toLowerCase();
  if (lower.includes('mobile') || lower.includes('phone') || lower.includes('android') || lower.includes('ios')) {
    return <Smartphone className={className} />;
  }
  if (lower.includes('tablet') || lower.includes('ipad')) {
    return <Tablet className={className} />;
  }
  return <Monitor className={className} />;
});
