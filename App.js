/**
 * ═══════════════════════════════════════════════════════════
 * App.js - ФИНАЛЬНАЯ ВЕРСИЯ v8.0
 * ═══════════════════════════════════════════════════════════
 *
 * ИСПРАВЛЕНО v8.0:
 * ─────────────────────────────────────────────────────────
 * БАГ: handleGlobalIncomingCall при currentRoute='Login' делал return.
 *      DeviceEventEmitter не хранит события — событие терялось навсегда.
 *      LoginScreen автологинится → navigate('Home') → HomeScreen монтируется,
 *      но слушать уже нечего. Звонок пропущен.
 *
 * ФИКС:
 *  1. Модульная переменная _pendingCallForNavigation — хранит данные звонка
 *     вне React-компонента пока навигация не достигнет HomeScreen.
 *  2. isNavReady ref — navigate() безопасен только после onReady().
 *  3. NavigationContainer.onReady() — проверяет pending при инициализации.
 *  4. NavigationContainer.onStateChange() — срабатывает при каждом переходе.
 *     Когда LoginScreen делает navigate('Home') → немедленно перенаправляет
 *     на IncomingCallScreen с сохранёнными данными.
 * ─────────────────────────────────────────────────────────
 */

import React, {useEffect, useRef} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import notifee, {EventType, AndroidImportance} from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import {Platform, Alert, DeviceEventEmitter} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
import ConnectionService from './src/services/ConnectionService';

const Stack = createNativeStackNavigator();

console.log('╔════════════════════════════════════════╗');
console.log('║  APP.JS v8.0 - COLD START FIX         ║');
console.log('╚════════════════════════════════════════╝');

/**
 * Хранилище pending-звонка вне React-компонента.
 *
 * Живёт в модульной области видимости — не зависит от lifecycle компонента
 * и не вызывает ре-рендеров. Сбрасывается после успешной навигации.
 *
 * @type {{ data: { from: string, isVideo: any, callId: string|null }, username: string } | null}
 */
let _pendingCallForNavigation = null;

export default function App() {
  const navigationRef = useRef(null);

  /**
   * Флаг: NavigationContainer полностью инициализирован.
   * navigate() безопасно вызывать ТОЛЬКО после onReady().
   * Используем ref (не state) — не провоцирует ре-рендер.
   */
  const isNavReady = useRef(false);

  useEffect(() => {
    initializeApp();

    /**
     * Глобальный слушатель 'incomingCall' от MainActivity (DeviceEventEmitter).
     *
     * КРИТИЧНО: Этот слушатель монтируется сразу при старте App.js,
     * до того как LoginScreen/HomeScreen появятся на экране.
     * Именно он перехватывает событие при холодном старте из FCM-уведомления.
     */
    const incomingCallSub = DeviceEventEmitter.addListener(
      'incomingCall',
      handleGlobalIncomingCall,
    );

    return () => {
      incomingCallSub.remove();
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // ИНИЦИАЛИЗАЦИЯ
  // ─────────────────────────────────────────────────────────────────────────

  const initializeApp = async () => {
    console.log('[App] 🚀 ИНИЦИАЛИЗАЦИЯ v8.0');
    try {
      await createNotificationChannels();
      await requestPermissions();
      setupForegroundHandler();
      setupNotifeeHandlers();
      await ensureServiceRunning();
      await registerPhoneAccount();
      console.log('[App] ✅ Инициализация завершена');
    } catch (error) {
      console.error('[App] ❌ Ошибка инициализации:', error);
    }
  };

  const createNotificationChannels = async () => {
    try {
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
      console.log('[App] ✅ Каналы созданы');
    } catch (error) {
      console.error('[App] ❌ Ошибка создания каналов:', error);
    }
  };

  const requestPermissions = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;
      console.log('[App]', enabled ? '✅ FCM разрешения получены' : '⚠️ FCM разрешения НЕ получены');
    } catch (error) {
      console.error('[App] ❌ Ошибка запроса разрешений:', error);
    }
  };

  const setupForegroundHandler = () => {
    const unsubscribe = messaging().onMessage(async remoteMessage => {
      console.log('[App FG] 📬 PUSH В FOREGROUND, data:', remoteMessage.data);
      const {data} = remoteMessage;
      if (!data) return;

      try {
        if (data.type === 'incoming_call') {
          // Приложение в foreground — сокет уже подключён, сервер шлёт incoming_call
          // через сокет. HomeScreen обработает. Показываем уведомление как резерв.
          await notifee.displayNotification({
            id: `call-fg-${data.from}-${Date.now()}`,
            title: data.isVideo === 'true' ? 'Входящий видеозвонок' : 'Входящий звонок',
            body: `${data.from} звонит вам`,
            android: {
              channelId: 'incoming-calls',
              importance: AndroidImportance.HIGH,
              fullScreenAction: {id: 'incoming_call', launchActivity: 'default'},
              actions: [
                {title: 'Ответить', pressAction: {id: 'answer', launchActivity: 'default'}},
                {title: 'Отклонить', pressAction: {id: 'reject'}},
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
        } else if (data.type === 'message') {
          await notifee.displayNotification({
            id: `msg-fg-${data.from}-${Date.now()}`,
            title: data.from,
            body: data.message,
            android: {channelId: 'messages'},
            data: {type: 'message', from: data.from},
          });
        }
      } catch (error) {
        console.error('[App FG] ❌ Ошибка:', error);
      }
    });
    return unsubscribe;
  };

  const setupNotifeeHandlers = () => {
    const unsubscribe = notifee.onForegroundEvent(({type, detail}) => {
      if (type === EventType.PRESS) {
        handleNotificationPress(detail);
      } else if (type === EventType.ACTION_PRESS) {
        handleNotificationAction(detail);
      }
    });
    return unsubscribe;
  };

  const ensureServiceRunning = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const running = await ConnectionService.isRunning();
      if (!running) {
        console.log('[App] Foreground service not running, restarting...');
        await ConnectionService.start();
      }
    } catch (e) {
      console.warn('[App] Service check failed:', e.message);
    }
  };

  const registerPhoneAccount = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const result = await ConnectionService.registerPhoneAccount();
      console.log('[App] PhoneAccount:', result ? 'registered' : 'failed/not supported');
    } catch (e) {
      console.warn('[App] PhoneAccount registration error:', e.message);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ОБРАБОТЧИК ВХОДЯЩИХ ЗВОНКОВ — ИСПРАВЛЕН v8.0
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Выполняет navigate('IncomingCall') когда это безопасно.
   *
   * Если навигация не готова или мы ещё на LoginScreen — сохраняем данные
   * в _pendingCallForNavigation. onStateChange подхватит их при переходе на Home.
   */
  const navigateToIncomingCall = (callData, username) => {
    const nav = navigationRef.current;

    if (!nav || !isNavReady.current) {
      console.log('[App] Nav not ready — storing pending call');
      _pendingCallForNavigation = {data: callData, username};
      return;
    }

    const routeName = nav.getCurrentRoute()?.name;

    if (routeName === 'IncomingCall' || routeName === 'Call') {
      console.log('[App] Already on call screen — skipping');
      _pendingCallForNavigation = null;
      return;
    }

    if (routeName === 'Login') {
      // LoginScreen сделает автологин → navigate('Home').
      // onStateChange поймает момент и перенаправит на IncomingCall.
      console.log('[App] Still on Login — storing pending call for onStateChange delivery');
      _pendingCallForNavigation = {data: callData, username};
      return;
    }

    // Все остальные экраны (Home, Chat, Settings и т.д.) — навигируем немедленно
    console.log('[App] 📲 Navigating to IncomingCallScreen, from:', callData.from);
    _pendingCallForNavigation = null;
    nav.navigate('IncomingCall', {
      from: callData.from,
      isVideo: callData.isVideo === true || callData.isVideo === 'true',
      username,
      callId: callData.callId || null,
    });
  };

  /**
   * Глобальный слушатель DeviceEventEmitter 'incomingCall'.
   *
   * ИСПРАВЛЕНИЕ v8.0:
   * Вместо `return` при route='Login' — сохраняем в _pendingCallForNavigation.
   * onStateChange доставит событие когда LoginScreen завершит автологин.
   */
  const handleGlobalIncomingCall = async data => {
    console.log('[App] 📞 Global incomingCall event, from:', data?.from);

    if (!data?.from) {
      console.warn('[App] incomingCall event without from field — ignoring');
      return;
    }

    let username = null;
    try {
      username = await AsyncStorage.getItem('username');
    } catch (e) {
      console.warn('[App] AsyncStorage read error:', e.message);
    }

    if (!username) {
      console.warn('[App] No saved username — cannot navigate to IncomingCallScreen');
      return;
    }

    navigateToIncomingCall(data, username);
  };

  /**
   * Вызывается при каждом изменении навигационного состояния.
   *
   * КЛЮЧЕВОЙ МОМЕНТ v8.0:
   * Когда LoginScreen делает navigation.replace('Home'), этот колбэк
   * срабатывает немедленно с route='Home'. Если есть _pendingCallForNavigation —
   * немедленно навигируем на IncomingCallScreen.
   *
   * Цепочка: DeviceEvent → Login (хранение) → Home (onStateChange) → IncomingCall
   */
  const handleNavigationStateChange = () => {
    if (!_pendingCallForNavigation) return;

    const routeName = navigationRef.current?.getCurrentRoute()?.name;
    console.log('[App] onStateChange, route:', routeName, '| pending call:', !!_pendingCallForNavigation);

    if (routeName === 'Home') {
      const {data, username} = _pendingCallForNavigation;
      _pendingCallForNavigation = null;

      console.log('[App] Home reached — delivering pending call to IncomingCallScreen');
      // Используем requestAnimationFrame чтобы дать навигации стабилизироваться
      requestAnimationFrame(() => {
        navigationRef.current?.navigate('IncomingCall', {
          from: data.from,
          isVideo: data.isVideo === true || data.isVideo === 'true',
          username,
          callId: data.callId || null,
        });
      });
    }
  };

  /**
   * NavigationContainer полностью инициализирован.
   *
   * Устанавливаем isNavReady и проверяем: вдруг DeviceEvent уже сработал
   * до инициализации навигации (редкий, но возможный race condition).
   */
  const handleNavigationReady = () => {
    console.log('[App] ✅ NavigationContainer ready');
    isNavReady.current = true;

    if (_pendingCallForNavigation) {
      console.log('[App] Pending call found on nav ready — delivering...');
      const {data, username} = _pendingCallForNavigation;
      navigateToIncomingCall(data, username);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ОБРАБОТЧИКИ УВЕДОМЛЕНИЙ
  // ─────────────────────────────────────────────────────────────────────────

  const handleNotificationPress = detail => {
    const data = detail.notification?.data || {};
    if (data.type === 'incoming_call') {
      console.log('[App] Notification press: incoming_call');
    } else if (data.type === 'message') {
      console.log('[App] Notification press: message');
    }
  };

  const handleNotificationAction = async detail => {
    const {notification, pressAction} = detail;
    const data = notification?.data || {};

    if (pressAction?.id === 'answer') {
      await notifee.cancelNotification(notification?.id);
      if (SocketService.isConnected()) {
        SocketService.acceptCall(data.from, data.callId);
      }
    } else if (pressAction?.id === 'reject') {
      await notifee.cancelNotification(notification?.id);
      if (SocketService.isConnected()) {
        SocketService.rejectCall(data.from, data.callId);
      }
    } else if (pressAction?.id === 'call_back') {
      console.log('[App] Call back:', data.from);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={handleNavigationReady}
      onStateChange={handleNavigationStateChange}>
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
  );
}