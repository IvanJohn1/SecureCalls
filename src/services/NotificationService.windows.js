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
    // Windows doesn't need explicit notification permission
    return true;
  }

  async getToken() {
    // No FCM token on Windows — return null
    // Server will use socket-only delivery for Windows clients
    return null;
  }

  async showNotification(title, body, data = {}) {
    // On Windows, use the Notification API if available
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
