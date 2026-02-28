/**
 * NotificationService for Windows — no FCM, use socket events only.
 * On Windows desktop, the app stays running so socket connection
 * is the primary mechanism for all real-time events.
 *
 * Windows toast notifications are used for:
 * - Incoming calls (when app is minimized)
 * - New messages (when app is minimized)
 * - Missed calls
 */

class WindowsNotificationService {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    console.log('[WindowsNotification] Initialized (socket-only mode)');
    this.initialized = true;
    return true;
  }

  async requestPermission() {
    return true;
  }

  async getToken() {
    return null;
  }

  async cancelAllNotifications() {
    // No-op on Windows
  }

  async showNotification(title, body, data = {}) {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, {body, data});
      }
    } catch (e) {
      console.warn('[WindowsNotification] Toast not available:', e.message);
    }
  }
}

export default new WindowsNotificationService();
