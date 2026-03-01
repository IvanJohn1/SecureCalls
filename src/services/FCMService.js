/**
 * FCMService.js — Firebase Cloud Messaging wrapper for Android/iOS.
 *
 * Abstracts @react-native-firebase/messaging so that platform-specific
 * .windows.js stub can replace it cleanly via Metro file resolution.
 */

import messaging from '@react-native-firebase/messaging';

/**
 * Get the FCM device token for push notifications.
 * @returns {Promise<string|null>}
 */
export async function getFCMToken() {
  try {
    return await messaging().getToken();
  } catch (error) {
    console.error('[FCMService] getToken error:', error);
    return null;
  }
}

/**
 * Subscribe to foreground FCM messages.
 * @param {Function} handler - Called with remoteMessage when a push arrives in foreground
 * @returns {Function} unsubscribe
 */
export function onMessage(handler) {
  return messaging().onMessage(handler);
}

/**
 * Request notification permission from the user.
 * @returns {Promise<number>} Authorization status
 */
export async function requestPermission() {
  return await messaging().requestPermission();
}

/**
 * Authorization status constants.
 */
export const AuthorizationStatus = messaging.AuthorizationStatus;
