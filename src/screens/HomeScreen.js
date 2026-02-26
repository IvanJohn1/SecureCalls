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
 * HomeScreen v8.1 FINAL — Telecom API + DeviceEvent Fix
 * ═══════════════════════════════════════════════════════════
 *
 * ИСПРАВЛЕНО v8.1:
 * ─────────────────────────────────────────────────────────
 * БАГ #1 (КРИТИЧЕСКИЙ): makeCall() не регистрировал исходящий звонок
 *   через Android Telecom API. Samsung Freecess убивал процесс во время
 *   разговора. ФИКС: ConnectionService.placeCall() перед navigate().
 *
 * БАГ #2 (СРЕДНИЙ): cleanupDeviceEventListeners() вызывал
 *   DeviceEventEmitter.removeAllListeners('incomingCall') — удалял
 *   ГЛОБАЛЬНЫЙ listener из App.js. После возврата HomeScreen → Call → Home
 *   App.js переставал получать события из MainActivity.
 *   ФИКС: сохраняем subscription ref, удаляем только свой listener.
 * ─────────────────────────────────────────────────────────
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
  const activeChatRef = useRef(null);
  // [FIX #2] Храним subscription чтобы удалять только свой listener
  const incomingCallSubRef = useRef(null);

  useEffect(() => {
    console.log('[HomeScreen v8.1] 🏠 Вход выполнен:', username);
    console.log('[HomeScreen v8.1] 👑 Админ:', isAdmin);

    setupSocketListeners();
    setupDeviceEventListeners();
    checkPendingCallFromStorage();
    SocketService.getUsers(true);
    SocketService.getUnreadCount();
    registerFCMToken();

    const subscription = AppState.addEventListener('change', handleAppStateChange);
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

  const registerFCMToken = async () => {
    try {
      const fcmToken = await messaging().getToken();
      if (fcmToken) {
        SocketService.registerFCMToken(username, fcmToken, 'android');
        console.log('[HomeScreen] ✅ FCM токен зарегистрирован');
      }
    } catch (error) {
      console.error('[HomeScreen] ❌ Ошибка регистрации FCM:', error);
    }
  };

  /**
   * [FIX #2] addListener возвращает subscription — сохраняем её.
   */
  const setupDeviceEventListeners = () => {
    incomingCallSubRef.current = DeviceEventEmitter.addListener(
      'incomingCall',
      handleIncomingCallFromIntent,
    );
  };

  /**
   * [FIX #2] subscription.remove() — удаляем ТОЛЬКО свой listener,
   * не трогая глобальный listener App.js.
   * Старый removeAllListeners('incomingCall') убивал App.js тоже — это был баг.
   */
  const cleanupDeviceEventListeners = () => {
    if (incomingCallSubRef.current) {
      incomingCallSubRef.current.remove();
      incomingCallSubRef.current = null;
    }
  };

  const handleIncomingCallFromIntent = data => {
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

  const checkPendingCallFromStorage = async () => {
    try {
      const stored = await AsyncStorage.getItem('pendingIncomingCall');
      if (!stored) return;

      const pending = JSON.parse(stored);
      const age = Date.now() - (pending.timestamp || 0);
      console.log('[HomeScreen] pendingIncomingCall found, age:', age, 'ms');

      if (pending.from && age < 45000) {
        await AsyncStorage.removeItem('pendingIncomingCall');
        console.log('[HomeScreen] 📲 Доставляем pending call from:', pending.from);
        navigation.navigate('IncomingCall', {
          from: pending.from,
          isVideo: pending.isVideo === true || pending.isVideo === 'true',
          username: username,
          callId: pending.callId || null,
        });
      } else {
        await AsyncStorage.removeItem('pendingIncomingCall');
        console.log('[HomeScreen] Stale pendingIncomingCall cleared (age:', age, 'ms)');
      }
    } catch (e) {
      console.warn('[HomeScreen] checkPendingCallFromStorage error:', e.message);
    }
  };

  const handleAppStateChange = async nextAppState => {
    console.log('[HomeScreen] 📱 AppState:', appState.current, '→', nextAppState);

    if (
      appState.current.match(/inactive|background/) &&
      nextAppState === 'active'
    ) {
      if (!SocketService.isConnected()) {
        try {
          const savedUsername = await AsyncStorage.getItem('username');
          const savedToken = await AsyncStorage.getItem('token');
          if (savedUsername && savedToken) {
            await SocketService.connect();
            await SocketService.authenticateWithToken(savedUsername, savedToken);
            SocketService.getUsers(true);
            await registerFCMToken();
          }
        } catch (error) {
          console.error('[HomeScreen] ❌ Ошибка переподключения:', error);
        }
      } else {
        SocketService.getUsers(true);
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
    setUsers(usersList);
    setIsLoading(false);
  };

  const handleUserOnline = data => {
    if (!isMountedRef.current) return;
    setUsers(prev => prev.map(u => u.username === data.username ? {...u, isOnline: true} : u));
  };

  const handleUserOffline = data => {
    if (!isMountedRef.current) return;
    setUsers(prev => prev.map(u => u.username === data.username ? {...u, isOnline: false} : u));
  };

  const handleNewMessageBadge = data => {
    if (!isMountedRef.current) return;
    if (!data || !data.from) return;
    if (activeChatRef.current === data.from) return;
    setUnreadCounts(prev => ({...prev, [data.from]: (prev[data.from] || 0) + 1}));
  };

  const handleUnreadCount = data => {
    if (!isMountedRef.current) return;
    if (!data || !data.unread) return;
    setUnreadCounts(prev => {
      const merged = {...prev};
      for (const [user, count] of Object.entries(data.unread)) {
        if (!merged[user] || merged[user] < count) merged[user] = count;
      }
      return merged;
    });
  };

  const handleIncomingCall = data => {
    console.log('[HomeScreen] 📞 Входящий звонок от:', data.from, 'callId:', data.callId);
    navigation.navigate('IncomingCall', {
      from: data.from,
      isVideo: data.isVideo,
      username: username,
      callId: data.callId,
    });
  };

  const handleForceDisconnect = data => {
    Alert.alert('Отключение', data.message, [{
      text: 'OK',
      onPress: async () => {
        await AsyncStorage.clear();
        navigation.replace('Login');
      },
    }]);
  };

  const handleDisconnect = () => {
    if (!isMountedRef.current || isLoggingOut.current) return;
    setConnectionStatus('disconnected');
  };

  const handleReconnecting = attempt => {
    if (!isMountedRef.current) return;
    setConnectionStatus('reconnecting');
    setReconnectAttempts(attempt);
  };

  const handleReconnect = () => {
    if (!isMountedRef.current) return;
    setConnectionStatus('connected');
    setReconnectAttempts(0);
    SocketService.getUsers(true);
    SocketService.getUnreadCount();
  };

  const handleSettingsPress = () => {
    navigation.navigate('Settings', {username, isAdmin});
  };

  const handleLogoutPress = () => {
    Alert.alert('Выход', 'Вы уверены, что хотите выйти?', [
      {text: 'Отмена', style: 'cancel'},
      {text: 'Выйти', style: 'destructive', onPress: handleLogoutConfirmed},
    ], {cancelable: true});
  };

  const handleLogoutConfirmed = async () => {
    isLoggingOut.current = true;
    try {
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
   * [FIX #1] Исходящий звонок через Android Telecom API.
   *
   * БЫЛО: SocketService.makeCall() → navigate() напрямую.
   *       Android не знал о звонке → Samsung Freecess убивал процесс.
   *
   * СТАЛО: ConnectionService.placeCall() регистрирует VoIPConnection
   *        через TelecomManager → процесс получает Freecess immunity.
   *        При ошибке Telecom — fallback на прямой SocketService.makeCall().
   */
  const makeCall = async (targetUser, isVideo) => {
    console.log('[HomeScreen v8.1] 📞 Звоним:', targetUser, 'видео:', isVideo);

    if (!SocketService.isConnected()) {
      Alert.alert('Ошибка', 'Нет подключения к серверу');
      return;
    }

    try {
      const telecomRegistered = await ConnectionService.placeCall(targetUser, isVideo);
      if (!telecomRegistered) {
        console.warn('[HomeScreen v8.1] Telecom placeCall вернул false, используем direct socket');
        SocketService.makeCall(targetUser, isVideo);
      }
    } catch (e) {
      console.warn('[HomeScreen v8.1] Telecom placeCall error, fallback:', e.message);
      SocketService.makeCall(targetUser, isVideo);
    }

    navigation.navigate('Call', {
      username: username,
      peer: targetUser,
      isVideo: isVideo,
      isCaller: true,
      callId: null,
    });
  };

  const openChat = targetUser => {
    if (!SocketService.isConnected()) {
      Alert.alert('Ошибка', 'Нет подключения к серверу');
      return;
    }
    setUnreadCounts(prev => { const u = {...prev}; delete u[targetUser]; return u; });
    activeChatRef.current = targetUser;
    navigation.navigate('Chat', {username, targetUser});
  };

  const renderUser = ({item}) => {
    const isOnline = item.isOnline || item.online;
    const unread = unreadCounts[item.username] || 0;

    return (
      <View style={styles.userCard}>
        <View style={styles.userInfo}>
          <View style={[styles.avatar, isOnline ? styles.avatarOnline : styles.avatarOffline]}>
            <Text style={styles.avatarText}>{item.username.substring(0, 2).toUpperCase()}</Text>
            {unread > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            )}
          </View>
          <View style={styles.userDetails}>
            <Text style={styles.username}>{item.username}</Text>
            <Text style={[styles.status, isOnline ? styles.statusOnline : styles.statusOffline]}>
              {isOnline ? '● В сети' : '○ Не в сети'}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionButton} onPress={() => openChat(item.username)}>
            <Text style={styles.actionIcon}>💬</Text>
            {unread > 0 && <View style={styles.actionUnreadDot} />}
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => makeCall(item.username, false)}>
            <Text style={styles.actionIcon}>📞</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => makeCall(item.username, true)}>
            <Text style={styles.actionIcon}>📹</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return '● Подключено • call.n8n-auto.space';
      case 'reconnecting': return `⟳ Переподключение... (${reconnectAttempts})`;
      case 'disconnected': return '○ Нет соединения';
      default: return '';
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return '#4CAF50';
      case 'reconnecting': return '#FF9800';
      case 'disconnected': return '#F44336';
      default: return '#999';
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#667eea" />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>SecureCall</Text>
          <View style={styles.headerSubtitleRow}>
            <Text style={styles.headerSubtitle}>Привет, {username}!</Text>
            {isAdmin && <Text style={styles.adminBadge}>👑</Text>}
          </View>
        </View>
        <View style={styles.headerButtons}>
          <TouchableOpacity style={styles.headerButton} onPress={handleSettingsPress}>
            <Text style={styles.headerButtonIcon}>⚙️</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={handleLogoutPress}>
            <Text style={styles.headerButtonIcon}>🚪</Text>
          </TouchableOpacity>
        </View>
      </View>

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
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>Нет других пользователей</Text>
              <Text style={styles.emptySubtext}>Зарегистрируйте других пользователей</Text>
            </View>
          }
        />
      )}

      <View style={styles.footer}>
        <Text style={[styles.footerText, {color: getConnectionStatusColor()}]}>
          {getConnectionStatusText()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#667eea', padding: 20, paddingTop: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flex: 1 },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  headerSubtitleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  headerSubtitle: { fontSize: 16, color: 'rgba(255,255,255,0.9)' },
  adminBadge: { fontSize: 16, marginLeft: 8 },
  headerButtons: { flexDirection: 'row' },
  headerButton: { width: 45, height: 45, borderRadius: 22.5, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  headerButtonIcon: { fontSize: 24 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 15, fontSize: 16, color: '#666' },
  list: { padding: 15 },
  userCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 15, borderRadius: 15, marginBottom: 12, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  userInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarOnline: { backgroundColor: '#667eea' },
  avatarOffline: { backgroundColor: '#999' },
  avatarText: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  userDetails: { flex: 1 },
  username: { fontSize: 18, fontWeight: '600', color: '#333' },
  status: { fontSize: 14, marginTop: 2 },
  statusOnline: { color: '#4CAF50' },
  statusOffline: { color: '#999' },
  actions: { flexDirection: 'row' },
  actionButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  actionIcon: { fontSize: 22 },
  unreadBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: '#F44336', borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, borderWidth: 2, borderColor: '#fff' },
  unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  actionUnreadDot: { position: 'absolute', top: 2, right: 2, width: 10, height: 10, borderRadius: 5, backgroundColor: '#F44336', borderWidth: 1.5, borderColor: '#f0f0f0' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, paddingTop: 100 },
  emptyText: { fontSize: 20, fontWeight: '600', color: '#999', textAlign: 'center' },
  emptySubtext: { fontSize: 16, color: '#bbb', textAlign: 'center', marginTop: 10 },
  footer: { padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e0e0e0', alignItems: 'center' },
  footerText: { fontSize: 14, fontWeight: '500' },
});
