import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { createLogger } from './logger';

const logger = createLogger('Permissions');

/**
 * Requests the Android 13+ POST_NOTIFICATIONS permission.
 * On other platforms, it returns true immediately.
 * 
 * @returns {Promise<boolean>} True if permission is granted, false otherwise.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  // We only need to request this specifically on Android 13+
  if (Capacitor.getPlatform() !== 'android') {
    return true;
  }

  try {
    // Check the current permission status
    let permStatus = await LocalNotifications.checkPermissions();

    // If it's not granted, request it
    if (permStatus.display !== 'granted') {
      logger.info('Requesting notification permission...');
      permStatus = await LocalNotifications.requestPermissions();
    }

    if (permStatus.display !== 'granted') {
      logger.warn('Notification permission denied. Media controls will be hidden.');
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Failed to request notification permission:', error);
    return false;
  }
}
