// services/firebase.js - v8.0 DATA-ONLY FIX
const admin = require('firebase-admin');
const path = require('path');

/**
 * ═══════════════════════════════════════════════════════════
 * FirebaseService v8.0 - DATA-ONLY FCM messages
 * ═══════════════════════════════════════════════════════════
 *
 * CRITICAL FIX v8.0:
 * All Android FCM messages are now DATA-ONLY (no android.notification block).
 *
 * WHY: With combined payload (data + notification), when the app is killed
 * or in background, Android automatically shows a basic system notification
 * from the notification block and onMessageReceived() is NOT called.
 * This means MyFirebaseMessagingService never fires, so:
 *   - No full-screen intent for calls
 *   - No action buttons (answer/reject)
 *   - No IncomingCallTaskService for socket pre-connect
 *   - No proper notification for messages in status bar
 *
 * With DATA-ONLY: onMessageReceived() fires in ALL states (foreground,
 * background, killed). The native Java service creates proper notifications.
 */

class FirebaseService {
  constructor() {
    this.initialized = false;
    this.enabled = process.env.ENABLE_PUSH_NOTIFICATIONS !== 'false';
  }

  async initialize() {
    if (this.initialized) {
      console.log('[Firebase] Already initialized');
      return true;
    }

    if (!this.enabled) {
      console.log('[Firebase] Push notifications disabled in config');
      return false;
    }

    try {
      console.log('[Firebase] Initializing...');

      const keyPath = process.env.FIREBASE_KEY_PATH || './firebase-admin-key.json';
      const resolvedPath = path.resolve(keyPath);

      const serviceAccount = require(resolvedPath);

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });

      this.initialized = true;

      console.log(`[Firebase] Initialized for project: ${serviceAccount.project_id}`);
      return true;
    } catch (error) {
      console.error('[Firebase] Init error:', error.message);
      this.enabled = false;
      return false;
    }
  }

  isReady() {
    return this.initialized && this.enabled;
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * INCOMING CALL — DATA-ONLY high-priority push
   * ═══════════════════════════════════════════════════════════
   *
   * Android: DATA-ONLY → onMessageReceived() fires in ALL app states.
   * MyFirebaseMessagingService.handleIncomingCall() creates proper
   * full-screen notification with answer/reject buttons.
   *
   * iOS: APNs alert payload (iOS handles this differently from Android).
   */
  async sendIncomingCallPush(fcmToken, fromUsername, isVideo, callId) {
    if (!this.isReady() || !fcmToken || !fromUsername) {
      console.warn('[Firebase] Cannot send call push: not ready or missing params');
      return null;
    }

    try {
      console.log(`[Firebase] Sending call push: ${fromUsername} → token:${fcmToken.substring(0, 15)}...`);

      const message = {
        token: fcmToken,

        // DATA-ONLY payload — onMessageReceived() fires in ALL app states
        data: {
          type: 'incoming_call',
          from: fromUsername,
          isVideo: isVideo.toString(),
          callId: callId || '',
          timestamp: Date.now().toString(),
        },

        android: {
          priority: 'high',
          ttl: 30000,
          // NO notification block — keeps it DATA-ONLY on Android
        },

        apns: {
          headers: {
            'apns-priority': '10',
            'apns-push-type': 'alert',
          },
          payload: {
            aps: {
              'content-available': 1,
              'interruption-level': 'time-sensitive',
              sound: 'default',
              category: 'CALL',
              badge: 1,
              alert: {
                title: isVideo ? 'Видеозвонок' : 'Входящий звонок',
                body: `${fromUsername} звонит вам`,
              },
            },
          },
        },
      };

      const response = await admin.messaging().send(message);
      console.log('[Firebase] Call push sent:', response);
      return response;
    } catch (error) {
      console.error('[Firebase] Call push error:', error.code, error.message);
      return this.handleSendError(error, fcmToken);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * MESSAGE NOTIFICATION — DATA-ONLY
   * ═══════════════════════════════════════════════════════════
   */
  async sendMessageNotification(fcmToken, fromUsername, message, messageId) {
    if (!this.isReady() || !fcmToken) {
      return null;
    }

    try {
      console.log(`[Firebase] Sending message push: ${fromUsername} → token:${fcmToken.substring(0, 15)}...`);

      const truncatedMessage = message.length > 1000
        ? message.substring(0, 1000) + '...'
        : message;

      const payload = {
        token: fcmToken,

        // DATA-ONLY — onMessageReceived() fires in ALL app states
        data: {
          type: 'message',
          from: fromUsername,
          message: truncatedMessage,
          messageId: messageId || '',
          timestamp: Date.now().toString(),
        },

        android: {
          priority: 'high',
          ttl: 86400000, // 24 hours
          // NO notification block
        },

        apns: {
          headers: {
            'apns-priority': '10',
          },
          payload: {
            aps: {
              'content-available': 1,
              alert: {
                title: 'Новое сообщение',
                body: `${fromUsername}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
              },
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const response = await admin.messaging().send(payload);
      console.log('[Firebase] Message push sent:', response);
      return response;
    } catch (error) {
      console.error('[Firebase] Message push error:', error.message);
      return this.handleSendError(error, fcmToken);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * MISSED CALL — DATA-ONLY
   * ═══════════════════════════════════════════════════════════
   */
  async sendMissedCallNotification(fcmToken, fromUsername, isVideo) {
    if (!this.isReady() || !fcmToken) {
      return null;
    }

    try {
      console.log(`[Firebase] Sending missed call push: ${fromUsername} → token:${fcmToken.substring(0, 15)}...`);

      const message = {
        token: fcmToken,

        // DATA-ONLY
        data: {
          type: 'missed_call',
          from: fromUsername,
          isVideo: isVideo.toString(),
          timestamp: Date.now().toString(),
        },

        android: {
          priority: 'high',
          // NO notification block
        },

        apns: {
          headers: {
            'apns-priority': '10',
          },
          payload: {
            aps: {
              alert: {
                title: isVideo ? 'Пропущенный видеозвонок' : 'Пропущенный звонок',
                body: `От: ${fromUsername}`,
              },
              sound: 'default',
              badge: 1,
              'interruption-level': 'time-sensitive',
            },
          },
        },
      };

      const response = await admin.messaging().send(message);
      console.log('[Firebase] Missed call push sent:', response);
      return response;
    } catch (error) {
      console.error('[Firebase] Missed call push error:', error.message);
      return this.handleSendError(error, fcmToken);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * CALL CANCELLED — DATA-ONLY (already was data-only)
   * ═══════════════════════════════════════════════════════════
   */
  async sendCallCancelledNotification(fcmToken, fromUsername) {
    if (!this.isReady() || !fcmToken) {
      return null;
    }

    try {
      const message = {
        token: fcmToken,
        data: {
          type: 'call_cancelled',
          from: fromUsername,
          timestamp: Date.now().toString(),
        },
        android: {
          priority: 'high',
          ttl: 5000,
        },
        apns: {
          headers: {
            'apns-priority': '10',
          },
          payload: {
            aps: {
              'content-available': 1,
            },
          },
        },
      };

      const response = await admin.messaging().send(message);
      console.log('[Firebase] Call cancelled push sent');
      return response;
    } catch (error) {
      console.error('[Firebase] Call cancelled push error:', error.message);
      return this.handleSendError(error, fcmToken);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════

  handleSendError(error, fcmToken) {
    if (
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered'
    ) {
      console.error('[Firebase] INVALID FCM TOKEN:', fcmToken.substring(0, 20) + '...');
      return { error: 'invalid_token', fcmToken };
    }

    if (error.code === 'messaging/quota-exceeded') {
      console.error('[Firebase] Quota exceeded');
      return { error: 'quota_exceeded' };
    }

    if (error.code === 'messaging/authentication-error') {
      console.error('[Firebase] Authentication error');
      return { error: 'auth_error' };
    }

    console.error('[Firebase] Unknown error:', error.code, error.message);
    return { error: 'unknown_error', message: error.message };
  }

  async sendMulticast(tokens, data) {
    if (!this.isReady() || !tokens || tokens.length === 0) {
      return null;
    }

    try {
      const stringifiedData = {};
      for (const [key, value] of Object.entries(data)) {
        stringifiedData[key] = String(value);
      }

      const message = {
        tokens: tokens,
        data: stringifiedData,
        android: { priority: 'high' },
        apns: {
          headers: { 'apns-priority': '10' },
          payload: { aps: { 'content-available': 1 } },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`[Firebase] Multicast: ${response.successCount}/${tokens.length} sent`);
      return response;
    } catch (error) {
      console.error('[Firebase] Multicast error:', error.message);
      return null;
    }
  }

  async verifyToken(fcmToken) {
    if (!this.isReady()) return false;

    try {
      await admin.messaging().send(
        { token: fcmToken, data: { test: 'true' } },
        true
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  getStats() {
    return {
      initialized: this.initialized,
      enabled: this.enabled,
      ready: this.isReady(),
    };
  }
}

const firebaseService = new FirebaseService();
module.exports = firebaseService;
