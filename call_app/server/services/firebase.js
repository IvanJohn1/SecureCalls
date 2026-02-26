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
 *
 * Логирование, обработка ошибок и multicast — сохранены из v7.2.1.
 */

class FirebaseService {
  constructor() {
    this.initialized = false;
    this.enabled = process.env.ENABLE_PUSH_NOTIFICATIONS !== 'false';
  }

  /**
   * Инициализация Firebase Admin SDK
   */
  async initialize() {
    if (this.initialized) {
      console.log('[Firebase] Уже инициализирован');
      return true;
    }

    if (!this.enabled) {
      console.log('[Firebase] Push-уведомления отключены в конфигурации');
      return false;
    }

    try {
      console.log('═══════════════════════════════════════');
      console.log('[Firebase] ИНИЦИАЛИЗАЦИЯ');
      console.log('═══════════════════════════════════════');

      const keyPath = process.env.FIREBASE_KEY_PATH || './firebase-admin-key.json';
      const resolvedPath = path.resolve(keyPath);
      
      console.log('[Firebase] Путь к ключу:', resolvedPath);
      
      const serviceAccount = require(resolvedPath);

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });

      this.initialized = true;
      
      console.log('[Firebase] ✅ Инициализирован успешно');
      console.log(`[Firebase] Проект: ${serviceAccount.project_id}`);
      console.log('═══════════════════════════════════════');
      
      return true;
    } catch (error) {
      console.error('[Firebase] ❌ Ошибка инициализации:', error.message);
      console.error('[Firebase] ⚠️ Push-уведомления НЕ будут работать!');
      console.error('[Firebase] Проверьте:');
      console.error('[Firebase]   1. Файл firebase-admin-key.json существует');
      console.error('[Firebase]   2. Путь указан правильно в .env');
      console.error('[Firebase]   3. JSON файл валиден');
      this.enabled = false;
      return false;
    }
  }

  /**
   * Проверка готовности
   */
  isReady() {
    return this.initialized && this.enabled;
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * ВХОДЯЩИЙ ЗВОНОК - КРИТИЧНО ВАЖНАЯ ФУНКЦИЯ
   * ═══════════════════════════════════════════════════════════
  *
   * FIX v8.0: DATA-ONLY message (без android.notification!)
   *
   * ПОЧЕМУ DATA-ONLY:
   * С combined payload (data + notification) при закрытом приложении
   * Android АВТОМАТИЧЕСКИ показывает простой notification из notification
   * блока, а onMessageReceived() в MyFirebaseMessagingService НЕ вызывается.
   * Это значит: нет full-screen intent, нет кнопок ответа/отклонения,
   * нет IncomingCallTaskService для pre-connect сокета.
   *
   * С DATA-ONLY: onMessageReceived() вызывается ВСЕГДА (foreground,
   * background, killed). MyFirebaseMessagingService создаёт правильный
   * notification с full-screen intent и action buttons.
   */
  async sendIncomingCallPush(fcmToken, fromUsername, isVideo, callId) {
    if (!this.isReady()) {
      console.warn('[Firebase] Сервис не готов, push не отправлен');
      return null;
    }
 
    if (!fcmToken) {
      console.warn('[Firebase] FCM токен отсутствует');
      return null;
    }
 
    if (!fromUsername) {
      console.warn('[Firebase] Отсутствует имя отправителя');
      return null;
    }
 
    try {
      console.log('═══════════════════════════════════════');
      console.log('[Firebase] ОТПРАВКА PUSH О ЗВОНКЕ (DATA-ONLY)');
      console.log('Кому:', fcmToken.substring(0, 20) + '...');
      console.log('От:', fromUsername);
      console.log('Видео:', isVideo);
      console.log('Время:', new Date().toISOString());
      console.log('═══════════════════════════════════════');
 
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
          // HIGH priority wakes the device and triggers onMessageReceived()
          priority: 'high',
          // TTL = 30 seconds
          ttl: 30000,
          // NO notification block — this makes it DATA-ONLY on Android
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
 
      console.log('[Firebase] Push о звонке отправлен УСПЕШНО');
      console.log('[Firebase] Response ID:', response);
      console.log('═══════════════════════════════════════');
 
      return response;
    } catch (error) {
      console.error('═══════════════════════════════════════');
      console.error('[Firebase] ОШИБКА отправки push о звонке');
      console.error('[Firebase] Error:', error.message);
      console.error('[Firebase] Error code:', error.code);
      console.error('[Firebase] Token:', fcmToken.substring(0, 20) + '...');
      console.error('═══════════════════════════════════════');
      return this.handleSendError(error, fcmToken);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * НОВОЕ СООБЩЕНИЕ - DATA MESSAGE
   * ═══════════════════════════════════════════════════════════
   */
  async sendMessageNotification(fcmToken, fromUsername, message, messageId) {
    if (!this.isReady()) {
      console.warn('[Firebase] ⚠️ Сервис не готов');
      return null;
    }

    if (!fcmToken) {
      console.warn('[Firebase] ⚠️ FCM токен отсутствует');
      return null;
    }

    try {
      console.log('═══════════════════════════════════════');
      console.log('[Firebase] ОТПРАВКА PUSH О СООБЩЕНИИ');
      console.log('Кому:', fcmToken.substring(0, 20) + '...');
      console.log('От:', fromUsername);
      console.log('Сообщение:', message.substring(0, 50) + '...');
      console.log('═══════════════════════════════════════');

      // Обрезать длинное сообщение для FCM
      const truncatedMessage = message.length > 1000 
        ? message.substring(0, 1000) + '...' 
        : message;

      const payload = {
        token: fcmToken,
        data: {
          type: 'message',
          from: fromUsername,
          message: truncatedMessage,
          messageId: messageId || '',
          timestamp: Date.now().toString(),
        },
        android: {
          priority: 'high',
          ttl: 86400000, // 24 часа
          // NO notification block — DATA-ONLY, onMessageReceived() fires in ALL app states
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
      
      console.log('[Firebase] ✅ Push о сообщении отправлен');
      console.log('[Firebase] Response:', response);
      console.log('═══════════════════════════════════════');
      
      return response;
    } catch (error) {
      console.error('[Firebase] ❌ Ошибка отправки push о сообщении:', error.message);
      return this.handleSendError(error, fcmToken);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * ПРОПУЩЕННЫЙ ЗВОНОК - DATA-ONLY
   * ═══════════════════════════════════════════════════════════
   *
   * DATA-ONLY: onMessageReceived() вызывается во всех состояниях,
   * нативный сервис создаёт правильное уведомление.
   */
  async sendMissedCallNotification(fcmToken, fromUsername, isVideo) {
    if (!this.isReady()) {
      console.warn('[Firebase] ⚠️ Сервис не готов');
      return null;
    }

    if (!fcmToken) {
      console.warn('[Firebase] ⚠️ FCM токен отсутствует');
      return null;
    }

    try {
      console.log('═══════════════════════════════════════');
      console.log('[Firebase] ОТПРАВКА УВЕДОМЛЕНИЯ О ПРОПУЩЕННОМ');
      console.log('Кому:', fcmToken.substring(0, 20) + '...');
      console.log('От:', fromUsername);
      console.log('Видео:', isVideo);
      console.log('═══════════════════════════════════════');

      const title = isVideo ? 'Пропущенный видеозвонок' : 'Пропущенный звонок';
      const body = `От: ${fromUsername}`;

      // DATA-ONLY — onMessageReceived() fires in ALL app states
      const message = {
        token: fcmToken,
        data: {
          type: 'missed_call',
          from: fromUsername,
          isVideo: isVideo.toString(),
          timestamp: Date.now().toString(),
        },
        android: {
          priority: 'high',
          // NO notification block — DATA-ONLY
        },
        apns: {
          headers: {
            'apns-priority': '10',
          },
          payload: {
            aps: {
              alert: {
                title: title,
                body: body,
              },
              sound: 'default',
              badge: 1,
              'interruption-level': 'time-sensitive',
            },
          },
        },
      };

      const response = await admin.messaging().send(message);
      
      console.log('[Firebase] ✅ Уведомление о пропущенном отправлено');
      console.log('[Firebase] Response:', response);
      console.log('═══════════════════════════════════════');
      
      return response;
    } catch (error) {
      console.error('[Firebase] ❌ Ошибка отправки уведомления о пропущенном:', error.message);
      return this.handleSendError(error, fcmToken);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * ЗВОНОК ОТМЕНЕН - Уведомление что звонок закончился
   * ═══════════════════════════════════════════════════════════
   */
  async sendCallCancelledNotification(fcmToken, fromUsername) {
    if (!this.isReady()) {
      console.warn('[Firebase] ⚠️ Сервис не готов');
      return null;
    }

    if (!fcmToken) {
      console.warn('[Firebase] ⚠️ FCM токен отсутствует');
      return null;
    }

    try {
      console.log('[Firebase] 🔴 Отправка уведомления об отмене звонка');

      const message = {
        token: fcmToken,
        data: {
          type: 'call_cancelled',
          from: fromUsername,
          timestamp: Date.now().toString(),
        },
        android: {
          priority: 'high',
          ttl: 5000, // 5 секунд - быстро устареет
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
      console.log('[Firebase] ✅ Уведомление об отмене отправлено');
      return response;
    } catch (error) {
      console.error('[Firebase] ❌ Ошибка отправки уведомления об отмене:', error.message);
      return this.handleSendError(error, fcmToken);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
   * ═══════════════════════════════════════════════════════════
   */

  /**
   * Обработка ошибок отправки
   */
  handleSendError(error, fcmToken) {
    // Проверка на невалидный токен
    if (
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered'
    ) {
      console.error('═══════════════════════════════════════');
      console.error('[Firebase] ❌ НЕВАЛИДНЫЙ FCM ТОКЕН');
      console.error('[Firebase] Токен:', fcmToken.substring(0, 20) + '...');
      console.error('[Firebase] ⚠️ Токен нужно удалить из базы данных');
      console.error('═══════════════════════════════════════');
      return { error: 'invalid_token', fcmToken };
    }

    // Проверка на ошибки квоты
    if (error.code === 'messaging/quota-exceeded') {
      console.error('[Firebase] ❌ Превышена квота отправки');
      return { error: 'quota_exceeded' };
    }

    // Проверка на ошибки аутентификации
    if (error.code === 'messaging/authentication-error') {
      console.error('[Firebase] ❌ Ошибка аутентификации Firebase');
      return { error: 'auth_error' };
    }

    // Другие ошибки
    console.error('[Firebase] ❌ Неизвестная ошибка:', error.code, error.message);
    return { error: 'unknown_error', message: error.message };
  }

  /**
   * Массовая отправка (опционально)
   */
  async sendMulticast(tokens, data) {
    if (!this.isReady()) {
      console.warn('[Firebase] ⚠️ Сервис не готов');
      return null;
    }

    if (!tokens || tokens.length === 0) {
      console.warn('[Firebase] ⚠️ Нет токенов для отправки');
      return null;
    }

    try {
      // Преобразовать все значения в строки
      const stringifiedData = {};
      for (const [key, value] of Object.entries(data)) {
        stringifiedData[key] = String(value);
      }

      const message = {
        tokens: tokens,
        data: stringifiedData,
        android: {
          priority: 'high',
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

      const response = await admin.messaging().sendEachForMulticast(message);
      
      console.log(`[Firebase] ✅ Multicast: ${response.successCount}/${tokens.length} успешно`);
      
      if (response.failureCount > 0) {
        console.error(`[Firebase] ❌ Ошибок: ${response.failureCount}`);
        
        // Логировать детали ошибок
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            console.error(`[Firebase] Токен ${idx}: ${resp.error?.message}`);
          }
        });
      }
      
      return response;
    } catch (error) {
      console.error('[Firebase] ❌ Ошибка multicast:', error.message);
      return null;
    }
  }

  /**
   * Проверка валидности токена
   */
  async verifyToken(fcmToken) {
    if (!this.isReady()) {
      return false;
    }

    try {
      // Отправляем тестовое сообщение с dry_run
      await admin.messaging().send(
        {
          token: fcmToken,
          data: { test: 'true' },
        },
        true // dry_run = true
      );
      
      console.log('[Firebase] ✅ Токен валиден');
      return true;
    } catch (error) {
      console.error('[Firebase] ❌ Токен невалиден:', error.message);
      return false;
    }
  }

  /**
   * Получение статистики
   */
  getStats() {
    return {
      initialized: this.initialized,
      enabled: this.enabled,
      ready: this.isReady(),
    };
  }
}

// Singleton экспорт
const firebaseService = new FirebaseService();

module.exports = firebaseService;