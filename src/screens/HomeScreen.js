import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  StatusBar,
  ActivityIndicator,
  AppState,
  DeviceEventEmitter,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import messaging from '@react-native-firebase/messaging';
import SocketService from '../services/SocketService';
import ConnectionService from '../services/ConnectionService';

/**
 * ═══════════════════════════════════════════════════════════
 * HomeScreen v7.0 FINAL - С ПОДДЕРЖКОЙ АДМИНА
 * ═══════════════════════════════════════════════════════════
 * 
 * НОВОЕ:
 * - Кнопка настроек
 * - Поддержка админа
 * - Улучшенная обработка ошибок
 * 
 * ═══════════════════════════════════════════════════════════
 * ДОПОЛНЕНИЯ v8.0 (резервный механизм):
 * - Добавлен вызов checkPendingCallFromStorage() в useEffect
 * - Добавлена функция checkPendingCallFromStorage для обработки звонков,
 *   сохранённых в AsyncStorage при получении FCM в убитом состоянии
 * ═══════════════════════════════════════════════════════════
 */

export default function HomeScreen({route, navigation}) {
  const {username, token, isAdmin = false} = route.params;

  const [users, setUsers] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('connected');
  const [isLoading, setIsLoading] = useState(true);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [unreadCounts, setUnreadCounts] = useState({});

  const isLoggingOut = useRef(false);
  const isMountedRef = useRef(true);
  const appState = useRef(AppState.currentState);
  // Track which chat is currently open (null when on HomeScreen)
  const activeChatRef = useRef(null);

  useEffect(() => {
    console.log('[HomeScreen v7.0] 🏠 Вход выполнен:', username);
    console.log('[HomeScreen v7.0] 👑 Админ:', isAdmin);

    // Подписаться на события
    setupSocketListeners();
    setupDeviceEventListeners();

    // НОВОЕ v8.0: Резервная проверка AsyncStorage при монтировании.
    // HeadlessTask (IncomingCallHeadlessTask.js) сохраняет данные звонка
    // в AsyncStorage['pendingIncomingCall'] при FCM с убитым приложением.
    // App.js onStateChange — основной механизм. Этот — страховка.
    checkPendingCallFromStorage();

    // Запросить список пользователей
    SocketService.getUsers(true);

    // Загрузить непрочитанные сообщения с сервера
    SocketService.getUnreadCount();

    // Регистрация FCM токена
    registerFCMToken();

    // Подписаться на изменения состояния приложения
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Clear active chat ref when this screen is focused (returned from ChatScreen)
    const unsubscribeFocus = navigation.addListener('focus', () => {
      activeChatRef.current = null;
    });

    return () => {
      isMountedRef.current = false;
      cleanupSocketListeners();
      cleanupDeviceEventListeners();
      subscription.remove();
      unsubscribeFocus();
    };
  }, []);

  /**
   * Регистрация FCM токена для push-уведомлений
   */
  const registerFCMToken = async () => {
    try {
      const fcmToken = await messaging().getToken();
      console.log('[HomeScreen] 🔔 FCM Token:', fcmToken);
      
      if (fcmToken) {
        SocketService.registerFCMToken(username, fcmToken, 'android');
        console.log('[HomeScreen] ✅ FCM токен зарегистрирован');
      }
    } catch (error) {
      console.error('[HomeScreen] ❌ Ошибка регистрации FCM:', error);
    }
  };

  /**
   * Настройка слушателей DeviceEventEmitter для входящих звонков
   */
  const setupDeviceEventListeners = () => {
    // Обработчик входящих звонков от MainActivity
    DeviceEventEmitter.addListener('incomingCall', handleIncomingCallFromIntent);
  };

  const cleanupDeviceEventListeners = () => {
    DeviceEventEmitter.removeAllListeners('incomingCall');
  };

  const handleIncomingCallFromIntent = (data) => {
    console.log('[HomeScreen] 📞 Входящий звонок от Intent:', data);

    if (data && data.from) {
      navigation.navigate('IncomingCall', {
        from: data.from,
        isVideo: data.isVideo || false,
        username: username,
        callId: data.callId || null,
      });
    }
  };

  /**
   * Резервная проверка AsyncStorage при монтировании HomeScreen.
   *
   * КОГДА СРАБАТЫВАЕТ:
   * Сценарий когда App.js onStateChange не успел или не сработал:
   * - FCM пришёл, HeadlessTask сохранил pendingIncomingCall в AsyncStorage
   * - App.js обработал DeviceEvent, но navigate из onStateChange не успел
   * - HomeScreen монтируется — проверяем AsyncStorage как последний резерв
   *
   * ВРЕМЕННОЙ ПОРОГ: 45 секунд — достаточно для холодного старта,
   * но не слишком долго чтобы показать устаревший звонок.
   */
  const checkPendingCallFromStorage = async () => {
    try {
      const stored = await AsyncStorage.getItem('pendingIncomingCall');
      if (!stored) return;

      const pending = JSON.parse(stored);
      const age = Date.now() - (pending.timestamp || 0);

      console.log('[HomeScreen] pendingIncomingCall found, age:', age, 'ms');

      if (pending.from && age < 45000) {
        // Сразу удаляем чтобы повторно не показать
        await AsyncStorage.removeItem('pendingIncomingCall');

        console.log('[HomeScreen] 📲 Доставляем pending call from:', pending.from);

        navigation.navigate('IncomingCall', {
          from: pending.from,
          isVideo: pending.isVideo === true || pending.isVideo === 'true',
          username: username,
          callId: pending.callId || null,
        });
      } else {
        // Устаревший или без from — удаляем мусор
        await AsyncStorage.removeItem('pendingIncomingCall');
        console.log('[HomeScreen] Stale pendingIncomingCall cleared (age:', age, 'ms)');
      }
    } catch (e) {
      console.warn('[HomeScreen] checkPendingCallFromStorage error:', e.message);
    }
  };

  /**
   * Обработка изменения состояния приложения
   */
  const handleAppStateChange = async nextAppState => {
    console.log('[HomeScreen] 📱 AppState:', appState.current, '→', nextAppState);

    if (
      appState.current.match(/inactive|background/) &&
      nextAppState === 'active'
    ) {
      console.log('[HomeScreen] ✨ Приложение вернулось в foreground');
      
      // Проверить подключение
      if (!SocketService.isConnected()) {
        console.log('[HomeScreen] 🔄 Переподключение...');
        try {
          const savedUsername = await AsyncStorage.getItem('username');
          const savedToken = await AsyncStorage.getItem('token');
          
          if (savedUsername && savedToken) {
            await SocketService.connect();
            await SocketService.authenticateWithToken(savedUsername, savedToken);
            SocketService.getUsers(true);
            
            // Перерегистрировать FCM токен
            await registerFCMToken();
          }
        } catch (error) {
          console.error('[HomeScreen] ❌ Ошибка переподключения:', error);
        }
      } else {
        console.log('[HomeScreen] ✅ Уже подключено');
        SocketService.getUsers(true);
        // Reload unread counts (messages may have arrived while in background)
        SocketService.getUnreadCount();
      }
    }

    appState.current = nextAppState;
  };

  const setupSocketListeners = () => {
    SocketService.on('users_list', handleUsersList);
    SocketService.on('user_online', handleUserOnline);
    SocketService.on('user_offline', handleUserOffline);
    SocketService.on('incoming_call', handleIncomingCall);
    SocketService.on('force_disconnect', handleForceDisconnect);
    SocketService.on('disconnect', handleDisconnect);
    SocketService.on('reconnecting', handleReconnecting);
    SocketService.on('connect', handleReconnect);
    SocketService.on('new_message', handleNewMessageBadge);
    SocketService.on('unread_count', handleUnreadCount);
  };

  const cleanupSocketListeners = () => {
    SocketService.off('users_list', handleUsersList);
    SocketService.off('user_online', handleUserOnline);
    SocketService.off('user_offline', handleUserOffline);
    SocketService.off('incoming_call', handleIncomingCall);
    SocketService.off('force_disconnect', handleForceDisconnect);
    SocketService.off('disconnect', handleDisconnect);
    SocketService.off('reconnecting', handleReconnecting);
    SocketService.off('connect', handleReconnect);
    SocketService.off('new_message', handleNewMessageBadge);
    SocketService.off('unread_count', handleUnreadCount);
  };

  const handleUsersList = usersList => {
    if (!isMountedRef.current) return;
    console.log('[HomeScreen] Users list:', usersList.length);
    setUsers(usersList);
    setIsLoading(false);
  };

  const handleUserOnline = data => {
    if (!isMountedRef.current) return;
    console.log('[HomeScreen] User online:', data.username);
    setUsers(prevUsers =>
      prevUsers.map(user =>
        user.username === data.username ? {...user, isOnline: true} : user,
      ),
    );
  };

  const handleUserOffline = data => {
    if (!isMountedRef.current) return;
    console.log('[HomeScreen] User offline:', data.username);
    setUsers(prevUsers =>
      prevUsers.map(user =>
        user.username === data.username ? {...user, isOnline: false} : user,
      ),
    );
  };

  /**
   * Track unread messages per user.
   * Increments badge when a new message arrives and user is NOT in that chat.
   */
  const handleNewMessageBadge = data => {
    if (!isMountedRef.current) return;
    if (!data || !data.from) return;

    // Don't count if user is currently in that chat
    if (activeChatRef.current === data.from) return;

    setUnreadCounts(prev => ({
      ...prev,
      [data.from]: (prev[data.from] || 0) + 1,
    }));
  };

  /**
   * Handle unread_count response from server.
   * Called on mount and reconnect to sync unread badges with database.
   * Server returns { unread: { senderUsername: count, ... } }
   */
  const handleUnreadCount = data => {
    if (!isMountedRef.current) return;
    if (!data || !data.unread) return;

    console.log('[HomeScreen] Unread counts from server:', data.unread);
    setUnreadCounts(prev => {
      // Merge server counts with any local increments
      const merged = {...prev};
      for (const [user, count] of Object.entries(data.unread)) {
        // Server count is authoritative; local increment is additive for new messages
        // that arrived while the screen is open
        if (!merged[user] || merged[user] < count) {
          merged[user] = count;
        }
      }
      return merged;
    });
  };

  const handleIncomingCall = data => {
    console.log('[HomeScreen] 📞 Входящий звонок от:', data.from, 'callId:', data.callId);

    // [FIX v11.0] Передаём callId чтобы IncomingCallScreen мог его использовать в accept_call
    navigation.navigate('IncomingCall', {
      from: data.from,
      isVideo: data.isVideo,
      username: username,
      callId: data.callId,
    });
  };

  const handleForceDisconnect = data => {
    Alert.alert('Отключение', data.message, [
      {
        text: 'OK',
        onPress: async () => {
          await AsyncStorage.clear();
          navigation.replace('Login');
        },
      },
    ]);
  };

  const handleDisconnect = () => {
    if (!isMountedRef.current) return;
    if (isLoggingOut.current) {
      console.log('[HomeScreen] Logging out - ignoring disconnect');
      return;
    }

    console.log('[HomeScreen] Connection lost');
    setConnectionStatus('disconnected');
  };

  const handleReconnecting = attempt => {
    if (!isMountedRef.current) return;
    console.log('[HomeScreen] Reconnecting, attempt:', attempt);
    setConnectionStatus('reconnecting');
    setReconnectAttempts(attempt);
  };

  const handleReconnect = () => {
    if (!isMountedRef.current) return;
    console.log('[HomeScreen] Reconnected');
    setConnectionStatus('connected');
    setReconnectAttempts(0);
    SocketService.getUsers(true);
    // Reload unread counts from server on reconnect
    SocketService.getUnreadCount();
  };

  /**
   * НОВОЕ: Открыть настройки
   */
  const handleSettingsPress = () => {
    navigation.navigate('Settings', {
      username: username,
      isAdmin: isAdmin,
    });
  };

  const handleLogoutPress = () => {
    Alert.alert(
      'Выход',
      'Вы уверены, что хотите выйти?',
      [
        {text: 'Отмена', style: 'cancel'},
        {text: 'Выйти', style: 'destructive', onPress: handleLogoutConfirmed},
      ],
      {cancelable: true},
    );
  };

  const handleLogoutConfirmed = async () => {
    isLoggingOut.current = true;
    console.log('[HomeScreen] 🚪 Выполняется выход');

    try {
      // Остановить Foreground Service
      console.log('[HomeScreen] ⏹️ Остановка Foreground Service');
      await ConnectionService.stop();
      
      await AsyncStorage.clear();
      SocketService.logout();
      SocketService.disconnect(true);
      navigation.replace('Login');
    } catch (error) {
      console.error('[HomeScreen] ❌ Ошибка выхода:', error);
      navigation.replace('Login');
    }
  };

  /**
   * Звонок пользователю
   * [FIX v11.0] callId будет получен через call_initiated/call_ringing_offline в CallScreen
   */
  const makeCall = (targetUser, isVideo) => {
    console.log('[HomeScreen] 📞 Звоним:', targetUser, 'видео:', isVideo);

    // Проверка подключения
    if (!SocketService.isConnected()) {
      Alert.alert('Ошибка', 'Нет подключения к серверу');
      return;
    }

    // Отправить запрос на звонок
    SocketService.makeCall(targetUser, isVideo);

    // Перейти на экран звонка; callId будет получен через call_initiated в CallScreen
    navigation.navigate('Call', {
      username: username,
      peer: targetUser,
      isVideo: isVideo,
      isCaller: true,
      callId: null, // заполнится через call_initiated/call_ringing_offline
    });
  };

  /**
   * Открыть чат — clears unread badge for this user
   */
  const openChat = targetUser => {
    console.log('[HomeScreen] Открываем чат с:', targetUser);

    // Проверка подключения
    if (!SocketService.isConnected()) {
      Alert.alert('Ошибка', 'Нет подключения к серверу');
      return;
    }

    // Clear unread count for this user
    setUnreadCounts(prev => {
      const updated = {...prev};
      delete updated[targetUser];
      return updated;
    });

    // Track active chat so new messages don't increment badge
    activeChatRef.current = targetUser;

    navigation.navigate('Chat', {
      username: username,
      targetUser: targetUser,
    });
  };

  const renderUser = ({item}) => {
    const isOnline = item.isOnline || item.online;
    const unread = unreadCounts[item.username] || 0;

    return (
      <View style={styles.userCard}>
        <View style={styles.userInfo}>
          <View
            style={[
              styles.avatar,
              isOnline ? styles.avatarOnline : styles.avatarOffline,
            ]}>
            <Text style={styles.avatarText}>
              {item.username.substring(0, 2).toUpperCase()}
            </Text>
            {/* Unread message badge on avatar */}
            {unread > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>
                  {unread > 99 ? '99+' : unread}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.userDetails}>
            <Text style={styles.username}>{item.username}</Text>
            <Text
              style={[
                styles.status,
                isOnline ? styles.statusOnline : styles.statusOffline,
              ]}>
              {isOnline ? '● В сети' : '○ Не в сети'}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => openChat(item.username)}>
            <Text style={styles.actionIcon}>💬</Text>
            {/* Unread badge on chat button */}
            {unread > 0 && (
              <View style={styles.actionUnreadDot} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => makeCall(item.username, false)}>
            <Text style={styles.actionIcon}>📞</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => makeCall(item.username, true)}>
            <Text style={styles.actionIcon}>📹</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderEmptyList = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>Нет других пользователей</Text>
      <Text style={styles.emptySubtext}>
        Зарегистрируйте других пользователей
      </Text>
    </View>
  );

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return '● Подключено • call.n8n-auto.space';
      case 'reconnecting':
        return `⟳ Переподключение... (${reconnectAttempts})`;
      case 'disconnected':
        return '○ Нет соединения';
      default:
        return '';
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return '#4CAF50';
      case 'reconnecting':
        return '#FF9800';
      case 'disconnected':
        return '#F44336';
      default:
        return '#999';
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#667eea" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>SecureCall</Text>
          <View style={styles.headerSubtitleRow}>
            <Text style={styles.headerSubtitle}>Привет, {username}!</Text>
            {isAdmin && <Text style={styles.adminBadge}>👑</Text>}
          </View>
        </View>
        <View style={styles.headerButtons}>
          {/* НОВОЕ: Кнопка настроек */}
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleSettingsPress}>
            <Text style={styles.headerButtonIcon}>⚙️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleLogoutPress}>
            <Text style={styles.headerButtonIcon}>🚪</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Users List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#667eea" />
          <Text style={styles.loadingText}>Загрузка пользователей...</Text>
        </View>
      ) : (
        <FlatList
          data={users}
          renderItem={renderUser}
          keyExtractor={item => item.username}
          contentContainerStyle={styles.list}
          ListEmptyComponent={renderEmptyList}
        />
      )}

      {/* Connection Status Footer */}
      <View style={styles.footer}>
        <Text
          style={[
            styles.footerText,
            {color: getConnectionStatusColor()},
          ]}>
          {getConnectionStatusText()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#667eea',
    padding: 20,
    paddingTop: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  adminBadge: {
    fontSize: 16,
    marginLeft: 8,
  },
  headerButtons: {
    flexDirection: 'row',
  },
  headerButton: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  headerButtonIcon: {
    fontSize: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#666',
  },
  list: {
    padding: 15,
  },
  userCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 15,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarOnline: {
    backgroundColor: '#667eea',
  },
  avatarOffline: {
    backgroundColor: '#999',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  userDetails: {
    flex: 1,
  },
  username: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  status: {
    fontSize: 14,
    marginTop: 2,
  },
  statusOnline: {
    color: '#4CAF50',
  },
  statusOffline: {
    color: '#999',
  },
  actions: {
    flexDirection: 'row',
  },
  actionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  actionIcon: {
    fontSize: 22,
  },
  unreadBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#F44336',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#fff',
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  actionUnreadDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#F44336',
    borderWidth: 1.5,
    borderColor: '#f0f0f0',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#999',
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 16,
    color: '#bbb',
    textAlign: 'center',
    marginTop: 10,
  },
  footer: {
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '500',
  },
});