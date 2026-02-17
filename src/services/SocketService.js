import io from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {SERVER_URL} from '../config/server.config';
import {AppState} from 'react-native';

/**
 * ═══════════════════════════════════════════════════════════
 * SocketService v10.0 PRODUCTION - ВСЕ КРИТИЧНЫЕ ИСПРАВЛЕНИЯ
 * ═══════════════════════════════════════════════════════════
 * 
 * ИСПРАВЛЕНО:
 * 1. ✅ Автоматическое переподключение с повторной авторизацией
 * 2. ✅ Сохранение токена для восстановления сессии
 * 3. ✅ Улучшенная обработка ошибок
 * 4. ✅ Защита от потери авторизации
 * 5. ✅ Keepalive для стабильного соединения
 */

console.log('╔════════════════════════════════════════╗');
console.log('║  SocketService v10.0 PRODUCTION       ║');
console.log('╚════════════════════════════════════════╝');

class SocketService {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = Infinity;
    this.keepaliveInterval = null;
    this.isManualDisconnect = false;
    
    // Сохраняем учетные данные для автопереподключения
    this.savedUsername = null;
    this.savedToken = null;
    
    // Флаг автопереподключения
    this.shouldAutoReconnect = false;

    AppState.addEventListener('change', this.handleAppStateChange);
  }

  /**
   * Обработка изменения состояния приложения
   */
  handleAppStateChange = async (nextAppState) => {
    console.log('[SocketService] AppState:', nextAppState);
    
    if (nextAppState === 'active' && this.shouldAutoReconnect) {
      // Приложение вернулось в foreground - проверить подключение
      if (!this.isConnected()) {
        console.log('[SocketService] 🔄 Приложение активно, восстанавливаем соединение');
        await this.reconnectWithAuth();
      }
    }
  };

  /**
   * Подключение к серверу
   */
  async connect() {
    if (this.socket?.connected) {
      console.log('[SocketService] Уже подключен');
      return;
    }

    console.log('═══════════════════════════════════════');
    console.log('[SocketService v10.0] ПОДКЛЮЧЕНИЕ');
    console.log('Сервер:', SERVER_URL);
    console.log('═══════════════════════════════════════');

    try {
      this.socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
        pingTimeout: 60000,
        pingInterval: 25000,
        autoConnect: true,
        forceNew: false,
      });

      this.setupSocketListeners();
      this.startKeepalive();

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Таймаут подключения'));
        }, 15000);

        this.socket.once('connect', () => {
          clearTimeout(timeout);
          console.log('[SocketService] ✓ ПОДКЛЮЧЕНО');
          this.isManualDisconnect = false;
          resolve();
        });

        this.socket.once('connect_error', error => {
          clearTimeout(timeout);
          console.error('[SocketService] ❌ Ошибка подключения:', error.message);
          reject(error);
        });
      });
    } catch (error) {
      console.error('[SocketService] ❌ Ошибка подключения:', error);
      throw error;
    }
  }

  /**
   * КРИТИЧНО: Настройка слушателей сокета
   */
  setupSocketListeners() {
    // Подключение установлено
    this.socket.on('connect', async () => {
      console.log('[SocketService] ✅ Подключено');
      this.reconnectAttempts = 0;
      this.notifyListeners('connect');
      
      // АВТОМАТИЧЕСКАЯ ПОВТОРНАЯ АВТОРИЗАЦИЯ
      if (this.shouldAutoReconnect && this.savedUsername && this.savedToken) {
        console.log('[SocketService] 🔐 Автоматическая повторная авторизация...');
        try {
          await this.authenticateWithToken(this.savedUsername, this.savedToken);
          console.log('[SocketService] ✅ Повторная авторизация успешна');
        } catch (error) {
          console.error('[SocketService] ❌ Ошибка повторной авторизации:', error);
          this.notifyListeners('auth_failed', {message: 'Не удалось восстановить сессию'});
        }
      }
    });

    // Отключение
    this.socket.on('disconnect', (reason) => {
      console.log('[SocketService] ⚠️ Отключено:', reason);
      this.notifyListeners('disconnect', reason);
      
      // Если это не ручное отключение - пытаемся переподключиться
      if (!this.isManualDisconnect && this.shouldAutoReconnect) {
        console.log('[SocketService] 🔄 Будет попытка автопереподключения');
      }
    });

    // Попытка переподключения
    this.socket.on('reconnect_attempt', (attempt) => {
      console.log(`[SocketService] 🔄 Попытка переподключения ${attempt}...`);
      this.reconnectAttempts = attempt;
      this.notifyListeners('reconnecting', attempt);
    });

    // Успешное переподключение
    this.socket.on('reconnect', (attempt) => {
      console.log(`[SocketService] ✅ Переподключено после ${attempt} попыток`);
      this.reconnectAttempts = 0;
      this.notifyListeners('reconnect', attempt);
    });

    // Ошибка переподключения
    this.socket.on('reconnect_error', (error) => {
      console.error('[SocketService] ❌ Ошибка переподключения:', error.message);
    });

    // Переподключение не удалось
    this.socket.on('reconnect_failed', () => {
      console.error('[SocketService] ❌ Переподключение не удалось');
      this.notifyListeners('reconnect_failed');
    });

    // Ошибка подключения
    this.socket.on('connect_error', (error) => {
      console.error('[SocketService] ❌ Ошибка подключения:', error.message);
    });

    // Входящий звонок
    this.socket.on('incoming_call', data => {
      console.log('[SocketService] 📞 INCOMING_CALL от:', data.from);
      this.notifyListeners('incoming_call', data);
    });

    // Остальные события
    this.socket.on('users_list', data => this.notifyListeners('users_list', data));
    this.socket.on('user_online', data => this.notifyListeners('user_online', data));
    this.socket.on('user_offline', data => this.notifyListeners('user_offline', data));
    this.socket.on('webrtc_offer', data => this.notifyListeners('webrtc_offer', data));
    this.socket.on('webrtc_answer', data => this.notifyListeners('webrtc_answer', data));
    this.socket.on('ice_candidate', data => this.notifyListeners('ice_candidate', data));
    this.socket.on('call_accepted', data => this.notifyListeners('call_accepted', data));
    this.socket.on('call_rejected', data => this.notifyListeners('call_rejected', data));
    this.socket.on('call_ended', data => this.notifyListeners('call_ended', data));
    this.socket.on('call_cancelled', data => this.notifyListeners('call_cancelled', data));
    this.socket.on('call_failed', data => this.notifyListeners('call_failed', data));
    this.socket.on('new_message', data => this.notifyListeners('new_message', data));
    this.socket.on('message_sent', data => this.notifyListeners('message_sent', data));
    this.socket.on('message_history', data => this.notifyListeners('message_history', data));
    this.socket.on('typing', data => this.notifyListeners('typing', data));
    this.socket.on('force_disconnect', data => this.notifyListeners('force_disconnect', data));
    this.socket.on('error', data => {
      console.error('[SocketService] ❌ Ошибка сервера:', data);
      this.notifyListeners('error', data);
    });
    
    // Админ события
    this.socket.on('user_deleted', data => this.notifyListeners('user_deleted', data));
    this.socket.on('user_banned', data => this.notifyListeners('user_banned', data));
  }

  /**
   * НОВОЕ: Переподключение с авторизацией
   */
  async reconnectWithAuth() {
    try {
      if (!this.savedUsername || !this.savedToken) {
        console.log('[SocketService] ⚠️ Нет сохраненных данных для переподключения');
        return false;
      }

      console.log('[SocketService] 🔄 Переподключение с авторизацией...');
      
      // Если сокет отключен - подключаем заново
      if (!this.socket || !this.socket.connected) {
        await this.connect();
      }
      
      // Авторизуемся
      await this.authenticateWithToken(this.savedUsername, this.savedToken);
      
      console.log('[SocketService] ✅ Переподключение успешно');
      return true;
      
    } catch (error) {
      console.error('[SocketService] ❌ Ошибка переподключения:', error);
      return false;
    }
  }

  /**
   * Keepalive для поддержания соединения
   */
  startKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
    }

    this.keepaliveInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('ping', {timestamp: Date.now()});
        // console.log('[SocketService] 💓 Keepalive');
      }
    }, 25000);

    console.log('[SocketService] ✓ Keepalive запущен');
  }

  stopKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
      console.log('[SocketService] Keepalive остановлен');
    }
  }

  /**
   * Отключение от сервера
   */
  disconnect(manual = false) {
    console.log('[SocketService] 🔌 Отключение (ручное:', manual, ')');

    this.isManualDisconnect = manual;
    if (manual) {
      this.shouldAutoReconnect = false;
      this.savedUsername = null;
      this.savedToken = null;
    }

    this.stopKeepalive();

    if (this.socket) {
      this.socket.disconnect();
      if (manual) {
        this.socket = null;
      }
    }
  }

  isConnected() {
    return this.socket?.connected || false;
  }

  /**
   * Регистрация
   */
  async register(username, password) {
    return new Promise((resolve, reject) => {
      this.socket.emit('register', {username, password});

      const timeout = setTimeout(() => {
        reject(new Error('Таймаут регистрации'));
      }, 10000);

      this.socket.once('register_success', async (data) => {
        clearTimeout(timeout);
        
        // Сохраняем данные для автопереподключения
        this.savedUsername = data.username;
        this.savedToken = data.token;
        this.shouldAutoReconnect = true;
        
        await AsyncStorage.setItem('username', data.username);
        await AsyncStorage.setItem('token', data.token);
        
        console.log('[SocketService] ✅ Регистрация успешна');
        resolve(data);
      });

      this.socket.once('register_error', (data) => {
        clearTimeout(timeout);
        reject(new Error(data.message));
      });
    });
  }

  /**
   * Вход
   */
  async login(username, password) {
    return new Promise((resolve, reject) => {
      this.socket.emit('login', {username, password});

      const timeout = setTimeout(() => {
        reject(new Error('Таймаут входа'));
      }, 10000);

      this.socket.once('login_success', async (data) => {
        clearTimeout(timeout);
        
        // Сохраняем данные для автопереподключения
        this.savedUsername = data.username;
        this.savedToken = data.token;
        this.shouldAutoReconnect = true;
        
        await AsyncStorage.setItem('username', data.username);
        await AsyncStorage.setItem('token', data.token);
        
        console.log('[SocketService] ✅ Вход успешен');
        resolve(data);
      });

      this.socket.once('login_error', (data) => {
        clearTimeout(timeout);
        reject(new Error(data.message));
      });
    });
  }

  /**
   * КРИТИЧНО: Авторизация по токену
   */
  async authenticateWithToken(username, token) {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Нет подключения к серверу'));
        return;
      }

      this.socket.emit('auth_token', {username, token});

      const timeout = setTimeout(() => {
        reject(new Error('Таймаут авторизации'));
      }, 10000);

      this.socket.once('auth_success', (data) => {
        clearTimeout(timeout);
        
        // Сохраняем данные для автопереподключения
        this.savedUsername = username;
        this.savedToken = token;
        this.shouldAutoReconnect = true;
        
        console.log('[SocketService] ✅ Авторизация по токену успешна');
        resolve(data);
      });

      this.socket.once('auth_error', (data) => {
        clearTimeout(timeout);
        console.error('[SocketService] ❌ Ошибка авторизации:', data.message);
        reject(new Error(data.message));
      });
    });
  }

  /**
   * Регистрация FCM токена
   */
  registerFCMToken(username, fcmToken, platform) {
    if (this.socket?.connected) {
      console.log('[SocketService] 📱 Регистрация FCM токена');
      this.socket.emit('register_fcm_token', {username, fcmToken, platform});
    } else {
      console.warn('[SocketService] ⚠️ Не подключен - FCM токен не зарегистрирован');
    }
  }

  logout() {
    if (this.socket?.connected) {
      this.socket.emit('logout');
    }
    
    // Очистить данные автопереподключения
    this.shouldAutoReconnect = false;
    this.savedUsername = null;
    this.savedToken = null;
  }

  // ═══════════════════════════════════════════════════════════
  // ЗВОНКИ
  // ═══════════════════════════════════════════════════════════
  makeCall(to, isVideo) {
    if (!this.socket?.connected) {
      console.error('[SocketService] ✗ Не подключен - невозможно позвонить');
      return false;
    }

    this.socket.emit('call', {to, isVideo});
    console.log('[SocketService] → Звонок:', to);
    return true;
  }

  acceptCall(from) {
    if (!this.socket?.connected) {
      console.error('[SocketService] ✗ Не подключен');
      return false;
    }

    this.socket.emit('accept_call', {from});
    console.log('[SocketService] → Звонок принят');
    return true;
  }

  rejectCall(from) {
    if (!this.socket?.connected) {
      console.error('[SocketService] ✗ Не подключен');
      return false;
    }

    this.socket.emit('reject_call', {from});
    console.log('[SocketService] → Звонок отклонен');
    return true;
  }

  endCall() {
    if (!this.socket?.connected) {
      console.error('[SocketService] ✗ Не подключен');
      return false;
    }

    this.socket.emit('end_call');
    console.log('[SocketService] → Звонок завершен');
    return true;
  }

  cancelCall(to) {
    if (!this.socket?.connected) {
      console.error('[SocketService] ✗ Не подключен');
      return false;
    }

    this.socket.emit('cancel_call', {to});
    console.log('[SocketService] → Звонок отменен');
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // WEBRTC
  // ═══════════════════════════════════════════════════════════
  sendWebRTCOffer(to, offer) {
    if (!this.socket?.connected) {
      console.error('[SocketService] ✗ Не подключен');
      return false;
    }

    this.socket.emit('webrtc_offer', {to, offer});
    console.log('[SocketService] → Offer отправлен');
    return true;
  }

  sendWebRTCAnswer(to, answer) {
    if (!this.socket?.connected) {
      console.error('[SocketService] ✗ Не подключен');
      return false;
    }

    this.socket.emit('webrtc_answer', {to, answer});
    console.log('[SocketService] → Answer отправлен');
    return true;
  }

  sendIceCandidate(to, candidate) {
    if (!this.socket?.connected) {
      return false;
    }

    this.socket.emit('ice_candidate', {to, candidate});
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // ПОЛЬЗОВАТЕЛИ
  // ═══════════════════════════════════════════════════════════
  getUsers(includeOffline = true) {
    if (!this.socket?.connected) {
      console.error('[SocketService] ✗ Не подключен');
      return false;
    }

    this.socket.emit('get_users', {includeOffline});
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // СООБЩЕНИЯ
  // ═══════════════════════════════════════════════════════════
  
  sendMessage(to, message, timestamp) {
    if (!this.socket?.connected) {
      console.error('[SocketService] ✗ Не подключен - невозможно отправить сообщение');
      return false;
    }

    try {
      this.socket.emit('send_message', {to, message, timestamp});
      console.log('[SocketService] → Сообщение отправлено');
      return true;
    } catch (error) {
      console.error('[SocketService] ✗ Ошибка отправки:', error);
      return false;
    }
  }

  getMessageHistory(withUser, limit = 100) {
    if (!this.socket?.connected) {
      console.warn('[SocketService] ⚠️ Не подключен - невозможно получить историю');
      return false;
    }

    this.socket.emit('get_messages', {withUser, limit});
    console.log('[SocketService] → Запрос истории сообщений с:', withUser);
    return true;
  }

  getMessages(withUser, limit = 100) {
    return this.getMessageHistory(withUser, limit);
  }

  markAsRead(from, messageId) {
    if (!this.socket?.connected) {
      return false;
    }

    this.socket.emit('mark_read', {from, messageId});
    return true;
  }

  sendTyping(to, isTyping) {
    if (!this.socket?.connected) {
      return false;
    }

    this.socket.emit('typing', {to, isTyping});
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // АДМИН ФУНКЦИИ
  // ═══════════════════════════════════════════════════════════

  adminDeleteUser(targetUsername) {
    if (!this.socket?.connected) {
      console.error('[SocketService] ✗ Не подключен');
      return false;
    }

    this.socket.emit('admin_delete_user', {targetUsername});
    console.log('[SocketService] → Админ: удаление пользователя', targetUsername);
    return true;
  }

  adminBanUser(targetUsername, reason) {
    if (!this.socket?.connected) {
      console.error('[SocketService] ✗ Не подключен');
      return false;
    }

    this.socket.emit('admin_ban_user', {targetUsername, reason});
    console.log('[SocketService] → Админ: бан пользователя', targetUsername);
    return true;
  }

  adminUnbanUser(targetUsername) {
    if (!this.socket?.connected) {
      console.error('[SocketService] ✗ Не подключен');
      return false;
    }

    this.socket.emit('admin_unban_user', {targetUsername});
    console.log('[SocketService] → Админ: разбан пользователя', targetUsername);
    return true;
  }

  deleteMyAccount() {
    if (!this.socket?.connected) {
      console.error('[SocketService] ✗ Не подключен');
      return false;
    }

    this.socket.emit('delete_my_account');
    console.log('[SocketService] → Удаление своего аккаунта');
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // СОБЫТИЯ
  // ═══════════════════════════════════════════════════════════
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  notifyListeners(event, data) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[SocketService] Ошибка в обработчике ${event}:`, error);
      }
    });
  }

  cleanup() {
    this.disconnect(true);
  }
}

export default new SocketService();