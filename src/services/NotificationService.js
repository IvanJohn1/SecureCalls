/**
 * ═══════════════════════════════════════════════════════════
 * NotificationService.js - ФИНАЛЬНАЯ ВЕРСИЯ v3.0
 * ═══════════════════════════════════════════════════════════
 * 
 * Простой сервис для управления уведомлениями
 */

import notifee, {AndroidImportance} from '@notifee/react-native';

class NotificationService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Инициализация (вызывается из App.js)
   */
  async initialize() {
    if (this.initialized) {
      console.log('[NotificationService] Уже инициализирован');
      return;
    }

    console.log('[NotificationService] Инициализация...');

    try {
      // Создать каналы
      await this.createChannels();

      this.initialized = true;
      console.log('[NotificationService] ✅ Инициализирован');
    } catch (error) {
      console.error('[NotificationService] ❌ Ошибка инициализации:', error);
    }
  }

  /**
   * Создание каналов
   */
  async createChannels() {
    console.log('[NotificationService] Создание каналов...');

    await notifee.createChannel({
      id: 'incoming-calls',
      name: 'Входящие звонки',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: true,
      vibrationPattern: [300, 500, 300, 500],
    });

    await notifee.createChannel({
      id: 'messages',
      name: 'Сообщения',
      importance: AndroidImportance.DEFAULT,
      sound: 'default',
    });

    await notifee.createChannel({
      id: 'missed-calls',
      name: 'Пропущенные звонки',
      importance: AndroidImportance.DEFAULT,
      sound: 'default',
    });

    console.log('[NotificationService] ✅ Каналы созданы');
  }

  /**
   * Отменить все уведомления
   */
  async cancelAllNotifications() {
    try {
      await notifee.cancelAllNotifications();
      console.log('[NotificationService] ✅ Все уведомления отменены');
    } catch (error) {
      console.error('[NotificationService] ❌ Ошибка отмены:', error);
    }
  }

  /**
   * Отменить конкретное уведомление
   */
  async cancelNotification(notificationId) {
    try {
      await notifee.cancelNotification(notificationId);
      console.log('[NotificationService] ✅ Уведомление отменено:', notificationId);
    } catch (error) {
      console.error('[NotificationService] ❌ Ошибка отмены:', error);
    }
  }
}

export default new NotificationService();