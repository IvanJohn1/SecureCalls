/**
 * ═══════════════════════════════════════════════════════════
 * index.js - ФИНАЛЬНАЯ ПРАВИЛЬНАЯ ВЕРСИЯ v3.0
 * ═══════════════════════════════════════════════════════════
 * 
 * КРИТИЧНО:
 * - Background handler ТОЛЬКО ЗДЕСЬ
 * - В App.js НЕ должно быть setBackgroundMessageHandler
 */

import {AppRegistry} from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, {AndroidImportance, AndroidCategory, EventType} from '@notifee/react-native';
import App from './App';
import {name as appName} from './app.json';

console.log('╔════════════════════════════════════════╗');
console.log('║  INDEX.JS v3.0 - ФИНАЛ                ║');
console.log('╚════════════════════════════════════════╝');

/**
 * 1. NOTIFEE BACKGROUND EVENT HANDLER
 */
notifee.onBackgroundEvent(async ({type, detail}) => {
  console.log('[Notifee BG] Event:', type);

  try {
    const {notification, pressAction} = detail;

    if (type === EventType.ACTION_PRESS) {
      if (pressAction?.id === 'reject') {
        await notifee.cancelNotification(notification?.id);
        console.log('[Notifee BG] Звонок отклонен');
      }
    }
  } catch (error) {
    console.error('[Notifee BG] Ошибка:', error);
  }
});

/**
 * 2. FCM BACKGROUND MESSAGE HANDLER
 * 
 * КРИТИЧНО: Этот handler ОБЯЗАТЕЛЬНО должен вернуть Promise
 */
messaging().setBackgroundMessageHandler(async remoteMessage => {
  console.log('════════════════════════════════════════');
  console.log('[FCM BG] 📬 PUSH ПОЛУЧЕН');
  console.log('[FCM BG] Data:', remoteMessage.data);
  console.log('════════════════════════════════════════');

  const {data} = remoteMessage;

  if (!data || !data.type) {
    console.log('[FCM BG] ⚠️ Нет данных');
    return Promise.resolve();
  }

  try {
    // ═══════════════════════════════════════
    // ВХОДЯЩИЙ ЗВОНОК
    // ═══════════════════════════════════════
    if (data.type === 'incoming_call') {
      console.log('[FCM BG] 📞 ВХОДЯЩИЙ ЗВОНОК от:', data.from);

      // 1. Создать канал
      const channelId = await notifee.createChannel({
        id: 'incoming-calls',
        name: 'Входящие звонки',
        importance: AndroidImportance.HIGH,
        sound: 'default',
        vibration: true,
        vibrationPattern: [300, 500, 300, 500],
      });

      console.log('[FCM BG] Канал создан:', channelId);

      // 2. Показать notification
      await notifee.displayNotification({
        id: `call-${data.from}-${Date.now()}`,
        title: data.isVideo === 'true' 
          ? '📹 Входящий видеозвонок' 
          : '📞 Входящий звонок',
        body: `${data.from} звонит вам`,
        android: {
          channelId: 'incoming-calls',
          importance: AndroidImportance.HIGH,
          
          // КРИТИЧНО: Full Screen Intent
          fullScreenAction: {
            id: 'default',
            launchActivity: 'default',
          },
          
          pressAction: {
            id: 'default',
            launchActivity: 'default',
          },
          
          actions: [
            {
              title: '✓ Ответить',
              pressAction: {
                id: 'answer',
                launchActivity: 'default',
              },
            },
            {
              title: '✕ Отклонить',
              pressAction: {
                id: 'reject',
              },
            },
          ],
          
          ongoing: true,
          autoCancel: false,
          category: AndroidCategory.CALL,
          sound: 'default',
          loopSound: true,
          lightUpScreen: true,
          visibility: 1, // PUBLIC
        },
        data: {
          type: 'incoming_call',
          from: data.from,
          isVideo: data.isVideo || 'false',
        },
      });

      console.log('[FCM BG] ✅ Notification показан');
    }
    
    // ═══════════════════════════════════════
    // НОВОЕ СООБЩЕНИЕ
    // ═══════════════════════════════════════
    else if (data.type === 'message') {
      console.log('[FCM BG] 💬 НОВОЕ СООБЩЕНИЕ от:', data.from);

      const channelId = await notifee.createChannel({
        id: 'messages',
        name: 'Сообщения',
        importance: AndroidImportance.DEFAULT,
        sound: 'default',
      });

      await notifee.displayNotification({
        id: `msg-${data.from}-${Date.now()}`,
        title: data.from || 'Новое сообщение',
        body: data.message || '',
        android: {
          channelId: 'messages',
          importance: AndroidImportance.DEFAULT,
          pressAction: {
            id: 'default',
            launchActivity: 'default',
          },
          sound: 'default',
        },
        data: {
          type: 'message',
          from: data.from,
        },
      });

      console.log('[FCM BG] ✅ Сообщение показано');
    }
    
    // ═══════════════════════════════════════
    // ПРОПУЩЕННЫЙ ЗВОНОК
    // ═══════════════════════════════════════
    else if (data.type === 'missed_call') {
      console.log('[FCM BG] 📞 ПРОПУЩЕННЫЙ ЗВОНОК от:', data.from);

      const channelId = await notifee.createChannel({
        id: 'missed-calls',
        name: 'Пропущенные звонки',
        importance: AndroidImportance.DEFAULT,
      });

      await notifee.displayNotification({
        id: `missed-${data.from}-${Date.now()}`,
        title: data.isVideo === 'true' 
          ? 'Пропущенный видеозвонок' 
          : 'Пропущенный звонок',
        body: `От: ${data.from}`,
        android: {
          channelId: 'missed-calls',
          actions: [
            {
              title: '📞 Перезвонить',
              pressAction: {
                id: 'call_back',
                launchActivity: 'default',
              },
            },
          ],
          sound: 'default',
        },
        data: {
          type: 'missed_call',
          from: data.from,
          isVideo: data.isVideo,
        },
      });

      console.log('[FCM BG] ✅ Пропущенный показан');
    }
  } catch (error) {
    console.error('[FCM BG] ❌ ОШИБКА:', error);
    console.error('[FCM BG] Stack:', error.stack);
  }

  // ОБЯЗАТЕЛЬНО вернуть Promise
  return Promise.resolve();
});

console.log('✅ Background handlers зарегистрированы');

// Регистрация приложения
AppRegistry.registerComponent(appName, () => App);