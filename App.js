/**
 * ═══════════════════════════════════════════════════════════
 * App.js - ФИНАЛЬНАЯ ВЕРСИЯ v7.0
 * ═══════════════════════════════════════════════════════════
 * 
 * НОВОЕ:
 * - Добавлены SettingsScreen и AdminPanelScreen
 * - Улучшена навигация
 * - Все исправления применены
 */

import React, {useEffect} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import notifee, {EventType, AndroidImportance} from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import {Platform, Alert} from 'react-native';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import CallScreen from './src/screens/CallScreen';
import IncomingCallScreen from './src/screens/IncomingCallScreen';
import ChatScreen from './src/screens/ChatScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AdminPanelScreen from './src/screens/AdminPanelScreen';

// Services
import SocketService from './src/services/SocketService';

const Stack = createNativeStackNavigator();

console.log('╔════════════════════════════════════════╗');
console.log('║  APP.JS v7.0 - ФИНАЛ                  ║');
console.log('╚════════════════════════════════════════╝');

export default function App() {
  useEffect(() => {
    initializeApp();

    return () => {
      // Cleanup
    };
  }, []);

  /**
   * Инициализация приложения
   */
  const initializeApp = async () => {
    console.log('[App] 🚀 ИНИЦИАЛИЗАЦИЯ');

    try {
      // 1. Создать notification каналы
      await createNotificationChannels();

      // 2. Запросить разрешения
      await requestPermissions();

      // 3. Настроить foreground handler
      setupForegroundHandler();

      // 4. Настроить notifee event handlers
      setupNotifeeHandlers();

      console.log('[App] ✅ Инициализация завершена');
    } catch (error) {
      console.error('[App] ❌ Ошибка инициализации:', error);
    }
  };

  /**
   * Создание notification каналов (КРИТИЧНО!)
   */
  const createNotificationChannels = async () => {
    console.log('[App] Создание каналов...');

    try {
      // Канал для входящих звонков
      await notifee.createChannel({
        id: 'incoming-calls',
        name: 'Входящие звонки',
        importance: AndroidImportance.HIGH,
        sound: 'default',
        vibration: true,
        vibrationPattern: [300, 500, 300, 500],
      });

      // Канал для сообщений
      await notifee.createChannel({
        id: 'messages',
        name: 'Сообщения',
        importance: AndroidImportance.DEFAULT,
        sound: 'default',
      });

      // Канал для пропущенных звонков
      await notifee.createChannel({
        id: 'missed-calls',
        name: 'Пропущенные звонки',
        importance: AndroidImportance.DEFAULT,
        sound: 'default',
      });

      console.log('[App] ✅ Каналы созданы');
    } catch (error) {
      console.error('[App] ❌ Ошибка создания каналов:', error);
    }
  };

  /**
   * Запрос разрешений
   */
  const requestPermissions = async () => {
    if (Platform.OS !== 'android') return;

    try {
      console.log('[App] Запрос разрешений FCM...');

      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (enabled) {
        console.log('[App] ✅ FCM разрешения получены');
      } else {
        console.warn('[App] ⚠️ FCM разрешения НЕ получены');
      }
    } catch (error) {
      console.error('[App] ❌ Ошибка запроса разрешений:', error);
    }
  };

  /**
   * Настройка foreground message handler
   * (Вызывается когда приложение ОТКРЫТО)
   */
  const setupForegroundHandler = () => {
    console.log('[App] Настройка foreground handler...');

    const unsubscribe = messaging().onMessage(async remoteMessage => {
      console.log('════════════════════════════════════════');
      console.log('[App FG] 📬 PUSH В FOREGROUND');
      console.log('[App FG] Data:', remoteMessage.data);
      console.log('════════════════════════════════════════');

      const {data} = remoteMessage;

      if (!data) return;

      try {
        if (data.type === 'incoming_call') {
          console.log('[App FG] 📞 Звонок от:', data.from);

          // Показать notification (даже в foreground)
          await notifee.displayNotification({
            id: `call-fg-${data.from}-${Date.now()}`,
            title: data.isVideo === 'true' 
              ? '📹 Входящий видеозвонок' 
              : '📞 Входящий звонок',
            body: `${data.from} звонит вам`,
            android: {
              channelId: 'incoming-calls',
              importance: AndroidImportance.HIGH,
              fullScreenAction: {
                id: 'default',
              },
              actions: [
                {
                  title: '✓ Ответить',
                  pressAction: {id: 'answer'},
                },
                {
                  title: '✕ Отклонить',
                  pressAction: {id: 'reject'},
                },
              ],
              ongoing: true,
              category: 'call',
            },
            data: {
              type: 'incoming_call',
              from: data.from,
              isVideo: data.isVideo,
            },
          });

          console.log('[App FG] ✅ Notification показан');
        } 
        else if (data.type === 'message') {
          console.log('[App FG] 💬 Сообщение от:', data.from);

          await notifee.displayNotification({
            id: `msg-fg-${data.from}-${Date.now()}`,
            title: data.from,
            body: data.message,
            android: {
              channelId: 'messages',
            },
            data: {
              type: 'message',
              from: data.from,
            },
          });

          console.log('[App FG] ✅ Сообщение показано');
        }
      } catch (error) {
        console.error('[App FG] ❌ Ошибка:', error);
      }
    });

    return unsubscribe;
  };

  /**
   * Настройка notifee event handlers
   */
  const setupNotifeeHandlers = () => {
    console.log('[App] Настройка notifee handlers...');

    // Foreground events
    const unsubscribe = notifee.onForegroundEvent(({type, detail}) => {
      console.log('[App] Notifee FG event:', type);

      if (type === EventType.PRESS) {
        handleNotificationPress(detail);
      } else if (type === EventType.ACTION_PRESS) {
        handleNotificationAction(detail);
      }
    });

    return unsubscribe;
  };

  /**
   * Обработка нажатия на notification
   */
  const handleNotificationPress = (detail) => {
    console.log('[App] 👆 Нажатие на notification');

    const {notification} = detail;
    const data = notification?.data || {};

    if (data.type === 'incoming_call') {
      console.log('[App] Открытие входящего звонка');
      // Навигация обработается автоматически через deep linking
    } else if (data.type === 'message') {
      console.log('[App] Открытие чата');
      // Навигация в чат
    }
  };

  /**
   * Обработка action button
   */
  const handleNotificationAction = async (detail) => {
    console.log('[App] 🎬 Action:', detail.pressAction?.id);

    const {notification, pressAction} = detail;
    const data = notification?.data || {};

    if (pressAction?.id === 'answer') {
      console.log('[App] ✅ Принять звонок от:', data.from);

      // Отменить notification
      await notifee.cancelNotification(notification?.id);

      // Принять через Socket
      if (SocketService.isConnected()) {
        SocketService.acceptCall(data.from);
      }
    } 
    else if (pressAction?.id === 'reject') {
      console.log('[App] ❌ Отклонить звонок от:', data.from);

      // Отменить notification
      await notifee.cancelNotification(notification?.id);

      // Отклонить через Socket
      if (SocketService.isConnected()) {
        SocketService.rejectCall(data.from);
      }
    } 
    else if (pressAction?.id === 'call_back') {
      console.log('[App] 📞 Перезвонить:', data.from);
      // Инициировать звонок
    }
  };

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Login"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Call" component={CallScreen} />
        <Stack.Screen
          name="IncomingCall"
          component={IncomingCallScreen}
          options={{
            gestureEnabled: false,
            animation: 'fade',
          }}
        />
        <Stack.Screen name="Chat" component={ChatScreen} />
        
        {/* НОВЫЕ ЭКРАНЫ */}
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="AdminPanel" component={AdminPanelScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
