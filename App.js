/**
 * ═══════════════════════════════════════════════════════════
 * App.js - ФИНАЛЬНАЯ ВЕРСИЯ v8.0 FIX
 * ═══════════════════════════════════════════════════════════
 *
 * v8.0 FIX:
 * - Removed premature ensureServiceRunning() from init
 * - Added navigationRef for proper incoming call navigation
 * - Fixed notification action handlers to navigate correctly
 * - Fixed message notification display in status bar
 */

import React, {useEffect, useRef} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createNavigationContainerRef} from '@react-navigation/native';
import notifee, {EventType, AndroidImportance} from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import {Platform} from 'react-native';
import {ThemeProvider} from './src/theme/ThemeContext';

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
export const navigationRef = createNavigationContainerRef();

console.log('╔════════════════════════════════════════╗');
console.log('║  APP.JS v8.0 FIX                       ║');
console.log('╚════════════════════════════════════════╝');

export default function App() {
  const isNavigationReady = useRef(false);

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
    console.log('[App] ИНИЦИАЛИЗАЦИЯ');

    try {
      // 1. Создать notification каналы
      await createNotificationChannels();

      // 2. Запросить разрешения
      await requestPermissions();

      // 3. Настроить foreground handler
      setupForegroundHandler();

      // 4. Настроить notifee event handlers
      setupNotifeeHandlers();

      // NOTE: Foreground service is started in LoginScreen after successful
      // login/auto-login. Do NOT start it here — the user may not be logged
      // in yet, and the service is meaningless without a socket connection.

      console.log('[App] Инициализация завершена');
    } catch (error) {
      console.error('[App] Ошибка инициализации:', error);
    }
  };

  /**
   * Создание notification каналов (КРИТИЧНО!)
   */
  const createNotificationChannels = async () => {
    console.log('[App] Создание каналов...');

    try {
      // Канал для входящих звонков
      // ID must match: MyFirebaseMessagingService.CHANNEL_ID_CALLS = "incoming_calls"
      // and AndroidManifest default_notification_channel_id = "incoming_calls"
      await notifee.createChannel({
        id: 'incoming_calls',
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
        importance: AndroidImportance.HIGH,
        sound: 'default',
      });

      // Канал для пропущенных звонков
      // ID must match: MyFirebaseMessagingService.CHANNEL_ID_MISSED = "missed_calls"
      await notifee.createChannel({
        id: 'missed_calls',
        name: 'Пропущенные звонки',
        importance: AndroidImportance.HIGH,
        sound: 'default',
      });

      console.log('[App] Каналы созданы');
    } catch (error) {
      console.error('[App] Ошибка создания каналов:', error);
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
        console.log('[App] FCM разрешения получены');
      } else {
        console.warn('[App] FCM разрешения НЕ получены');
      }
    } catch (error) {
      console.error('[App] Ошибка запроса разрешений:', error);
    }
  };

  /**
   * Настройка foreground message handler
   * (Вызывается когда приложение ОТКРЫТО и FCM push приходит)
   *
   * NOTE: This only fires if @react-native-firebase/messaging intercepts the
   * FCM message. If MyFirebaseMessagingService intercepts it first (because
   * it has a higher-priority intent-filter), this handler will NOT fire.
   * In that case, the native service handles notifications itself.
   */
  const setupForegroundHandler = () => {
    console.log('[App] Настройка foreground handler...');

    const unsubscribe = messaging().onMessage(async remoteMessage => {
      console.log('════════════════════════════════════════');
      console.log('[App FG] PUSH В FOREGROUND');
      console.log('[App FG] Data:', remoteMessage.data);
      console.log('════════════════════════════════════════');

      const {data} = remoteMessage;

      if (!data) return;

      try {
        if (data.type === 'incoming_call') {
          console.log('[App FG] Call from:', data.from);

          // Show notification even in foreground
          await notifee.displayNotification({
            id: `call-fg-${data.from}-${Date.now()}`,
            title: data.isVideo === 'true'
              ? 'Входящий видеозвонок'
              : 'Входящий звонок',
            body: `${data.from} звонит вам`,
            android: {
              channelId: 'incoming_calls',
              importance: AndroidImportance.HIGH,
              smallIcon: 'ic_launcher',
              fullScreenAction: {
                id: 'incoming_call',
                launchActivity: 'default',
              },
              actions: [
                {
                  title: 'Ответить',
                  pressAction: {id: 'answer', launchActivity: 'default'},
                },
                {
                  title: 'Отклонить',
                  pressAction: {id: 'reject'},
                },
              ],
              ongoing: true,
              category: 'call',
            },
            data: {
              type: 'incoming_call',
              from: data.from,
              isVideo: data.isVideo || 'false',
              callId: data.callId || '',
            },
          });

          console.log('[App FG] Notification shown');
        }
        else if (data.type === 'message') {
          console.log('[App FG] Сообщение от:', data.from);

          await notifee.displayNotification({
            id: `msg-fg-${data.from}-${Date.now()}`,
            title: data.from,
            body: data.message,
            android: {
              channelId: 'messages',
              importance: AndroidImportance.HIGH,
              smallIcon: 'ic_launcher',
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

          console.log('[App FG] Сообщение показано');
        }
      } catch (error) {
        console.error('[App FG] Ошибка:', error);
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
    console.log('[App] Нажатие на notification');

    const {notification} = detail;
    const data = notification?.data || {};

    if (data.type === 'incoming_call') {
      console.log('[App] Открытие входящего звонка от:', data.from);
      // Navigate to IncomingCallScreen if we can
      navigateToIncomingCall(data);
    } else if (data.type === 'message') {
      console.log('[App] Открытие чата с:', data.from);
      // Chat navigation is handled by HomeScreen through Intent
    }
  };

  /**
   * Обработка action button
   */
  const handleNotificationAction = async (detail) => {
    console.log('[App] Action:', detail.pressAction?.id);

    const {notification, pressAction} = detail;
    const data = notification?.data || {};

    if (pressAction?.id === 'answer') {
      console.log('[App] Accept call from:', data.from);
      await notifee.cancelNotification(notification?.id);
      // Navigate to IncomingCallScreen which will handle accept
      navigateToIncomingCall(data);
    }
    else if (pressAction?.id === 'reject') {
      console.log('[App] Reject call from:', data.from);
      await notifee.cancelNotification(notification?.id);
      if (SocketService.isConnected()) {
        SocketService.rejectCall(data.from, data.callId);
      }
    }
    else if (pressAction?.id === 'call_back') {
      console.log('[App] Перезвонить:', data.from);
    }
  };

  /**
   * Navigate to IncomingCallScreen using navigationRef
   */
  const navigateToIncomingCall = (data) => {
    if (!data.from) return;
    if (navigationRef.isReady()) {
      navigationRef.navigate('IncomingCall', {
        from: data.from,
        isVideo: data.isVideo === 'true' || data.isVideo === true,
        username: SocketService.savedUsername || '',
        callId: data.callId || null,
      });
    } else {
      console.warn('[App] Navigation not ready, waiting...');
      // Retry after navigation is ready
      const interval = setInterval(() => {
        if (navigationRef.isReady()) {
          clearInterval(interval);
          navigationRef.navigate('IncomingCall', {
            from: data.from,
            isVideo: data.isVideo === 'true' || data.isVideo === true,
            username: SocketService.savedUsername || '',
            callId: data.callId || null,
          });
        }
      }, 500);
      // Stop trying after 10s
      setTimeout(() => clearInterval(interval), 10000);
    }
  };

  return (
    <ThemeProvider>
      <NavigationContainer ref={navigationRef} onReady={() => {
        isNavigationReady.current = true;
      }}>
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
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="AdminPanel" component={AdminPanelScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeProvider>
  );
}
