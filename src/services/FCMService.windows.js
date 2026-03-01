/**
 * FCMService.windows.js — Windows stub (no Firebase Cloud Messaging).
 *
 * On Windows desktop, push notifications are not available via FCM.
 * The app relies on Socket.IO for all real-time event delivery.
 * Metro resolves this file instead of FCMService.js when bundling for Windows.
 */

/**
 * No FCM on Windows — return null.
 * @returns {Promise<null>}
 */
export async function getFCMToken() {
  console.log('[FCMService] Windows — no FCM token available');
  return null;
}

/**
 * No-op on Windows — returns a no-op unsubscribe function.
 * @returns {Function} unsubscribe (no-op)
 */
export function onMessage(_handler) {
  return () => {};
}

/**
 * No permission needed on Windows.
 * @returns {Promise<number>} Always returns 1 (AUTHORIZED)
 */
export async function requestPermission() {
  return 1; // AUTHORIZED
}

/**
 * Authorization status constants stub.
 */
export const AuthorizationStatus = {
  NOT_DETERMINED: -1,
  DENIED: 0,
  AUTHORIZED: 1,
  PROVISIONAL: 2,
};
