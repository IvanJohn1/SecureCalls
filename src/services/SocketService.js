import io from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {SERVER_URL} from '../config/server.config';
import {AppState, NativeModules} from 'react-native';

const {NativeStorage} = NativeModules;

/**
 * ═══════════════════════════════════════════════════════════
 * SocketService v12.0 — Fixed Reconnect + State Machine
 * ═══════════════════════════════════════════════════════════
 *
 * v12.0 fixes:
 * 1. Connection state machine: DISCONNECTED -> CONNECTING -> CONNECTED -> AUTHENTICATING -> AUTHENTICATED
 * 2. Race condition fix: auth only runs inside 'connect' handler, guarded by isAuthenticating flag
 * 3. Exponential backoff for manual reconnect (1s, 2s, 4s, 8s, max 30s)
 * 4. Keepalive properly cleaned on disconnect
 * 5. Connection timeout does NOT log user out — only explicit auth_error does
 * 6. Reconnect indicator after 3s of DISCONNECTED state
 */

console.log('╔════════════════════════════════════════╗');
console.log('║  SocketService v12.0 STATE MACHINE     ║');
console.log('╚════════════════════════════════════════╝');

// Connection states
const STATE = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  AUTHENTICATING: 'AUTHENTICATING',
  AUTHENTICATED: 'AUTHENTICATED',
};

class SocketService {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.keepaliveInterval = null;
    this.isManualDisconnect = false;

    // State machine
    this.connectionState = STATE.DISCONNECTED;
    this.isAuthenticating = false;

    // Credentials for auto-reconnect
    this.savedUsername = null;
    this.savedToken = null;
    this.shouldAutoReconnect = false;

    // Reconnect backoff
    this.reconnectBackoff = 1000;
    this.maxReconnectBackoff = 30000;
    this.reconnectTimer = null;

    AppState.addEventListener('change', this.handleAppStateChange);
  }

  _setState(newState) {
    if (this.connectionState !== newState) {
      console.log(`[SocketService] State: ${this.connectionState} -> ${newState}`);
      this.connectionState = newState;
      this.notifyListeners('connection_state', newState);
    }
  }

  /**
   * Handle app state changes
   */
  handleAppStateChange = async (nextAppState) => {
    console.log('[SocketService] AppState:', nextAppState);

    if (nextAppState === 'active' && this.shouldAutoReconnect) {
      // Reset backoff when app comes to foreground
      this.reconnectBackoff = 1000;

      if (!this.isConnected()) {
        console.log('[SocketService] App active, reconnecting...');
        this._scheduleReconnect(0); // immediate
      }
    }
  };

  /**
   * Connect to server
   */
  async connect() {
    if (this.socket?.connected) {
      console.log('[SocketService] Already connected');
      return;
    }

    // Prevent multiple simultaneous connect attempts
    if (this.connectionState === STATE.CONNECTING) {
      console.log('[SocketService] Already connecting, waiting...');
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Таймаут подключения')), 15000);
        const onConnect = () => { clearTimeout(timeout); resolve(); };
        const onError = (err) => { clearTimeout(timeout); reject(err); };
        this.socket?.once('connect', onConnect);
        this.socket?.once('connect_error', onError);
      });
    }

    this._setState(STATE.CONNECTING);

    console.log('═══════════════════════════════════════');
    console.log('[SocketService v12.0] CONNECTING');
    console.log('Server:', SERVER_URL);
    console.log('═══════════════════════════════════════');

    try {
      // Clean up old socket if exists
      if (this.socket) {
        try { this.socket.removeAllListeners(); this.socket.disconnect(); } catch (e) { /* ignore */ }
        this.socket = null;
      }

      this.socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
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
          this._setState(STATE.DISCONNECTED);
          reject(new Error('Таймаут подключения'));
        }, 15000);

        this.socket.once('connect', () => {
          clearTimeout(timeout);
          console.log('[SocketService] CONNECTED');
          this.isManualDisconnect = false;
          resolve();
        });

        this.socket.once('connect_error', error => {
          clearTimeout(timeout);
          console.error('[SocketService] Connection error:', error.message);
          this._setState(STATE.DISCONNECTED);
          reject(error);
        });
      });
    } catch (error) {
      console.error('[SocketService] Connection error:', error);
      this._setState(STATE.DISCONNECTED);
      throw error;
    }
  }

  /**
   * Socket event listeners
   */
  setupSocketListeners() {
    // Connected
    this.socket.on('connect', async () => {
      console.log('[SocketService] Connected');
      this._setState(STATE.CONNECTED);
      this.reconnectBackoff = 1000; // Reset backoff
      this.notifyListeners('connect');

      // AUTO RE-AUTH: only attempt if we have saved credentials
      if (this.shouldAutoReconnect && this.savedUsername && this.savedToken) {
        if (this.isAuthenticating) {
          console.log('[SocketService] Auth already in progress, skipping');
          return;
        }

        console.log('[SocketService] Auto re-authenticating...');
        try {
          await this.authenticateWithToken(this.savedUsername, this.savedToken);
          console.log('[SocketService] Re-authentication successful');
        } catch (error) {
          console.error('[SocketService] Re-authentication failed:', error.message);
          this.notifyListeners('auth_failed', {message: 'Не удалось восстановить сессию'});
        }
      }
    });

    // Disconnected
    this.socket.on('disconnect', (reason) => {
      console.log('[SocketService] Disconnected:', reason);
      this.isAuthenticating = false;
      this._setState(STATE.DISCONNECTED);
      this.notifyListeners('disconnect', reason);

      // Schedule reconnect for 'io server disconnect' (server-initiated)
      // Socket.IO auto-reconnects for transport issues, but NOT for server disconnect
      if (reason === 'io server disconnect' && !this.isManualDisconnect && this.shouldAutoReconnect) {
        console.log('[SocketService] Server initiated disconnect, scheduling reconnect...');
        this._scheduleReconnect();
      }
    });

    // Reconnection events from socket.io
    this.socket.on('reconnect_attempt', (attempt) => {
      console.log(`[SocketService] Reconnect attempt ${attempt}...`);
      this._setState(STATE.CONNECTING);
      this.notifyListeners('reconnecting', attempt);
    });

    this.socket.on('reconnect', (attempt) => {
      console.log(`[SocketService] Reconnected after ${attempt} attempts`);
      this.notifyListeners('reconnect', attempt);
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('[SocketService] Reconnect error:', error.message);
    });

    this.socket.on('reconnect_failed', () => {
      console.error('[SocketService] Reconnect failed');
      this._setState(STATE.DISCONNECTED);
      this.notifyListeners('reconnect_failed');
    });

    this.socket.on('connect_error', (error) => {
      console.error('[SocketService] Connect error:', error.message);
    });

    // Incoming call
    this.socket.on('incoming_call', data => {
      console.log('[SocketService] INCOMING_CALL from:', data.from);
      this.notifyListeners('incoming_call', data);
    });

    // All other events
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
    this.socket.on('call_initiated', data => {
      console.log('[SocketService] call_initiated, callId:', data.callId);
      this.notifyListeners('call_initiated', data);
    });
    this.socket.on('call_timeout', data => {
      console.log('[SocketService] call_timeout');
      this.notifyListeners('call_timeout', data);
    });
    this.socket.on('call_ringing_offline', data => {
      console.log('[SocketService] call_ringing_offline, callId:', data.callId);
      this.notifyListeners('call_ringing_offline', data);
    });
    this.socket.on('new_message', data => this.notifyListeners('new_message', data));
    this.socket.on('message_sent', data => this.notifyListeners('message_sent', data));
    this.socket.on('message_history', data => this.notifyListeners('message_history', data));
    this.socket.on('typing', data => this.notifyListeners('typing', data));
    this.socket.on('force_disconnect', data => {
      // Server asked us to disconnect — don't auto-reconnect
      this.shouldAutoReconnect = false;
      this.notifyListeners('force_disconnect', data);
    });
    this.socket.on('error', data => {
      console.error('[SocketService] Server error:', data);
      this.notifyListeners('error', data);
    });

    // Admin events
    this.socket.on('user_deleted', data => this.notifyListeners('user_deleted', data));
    this.socket.on('user_banned', data => this.notifyListeners('user_banned', data));
  }

  /**
   * Schedule reconnect with exponential backoff
   */
  _scheduleReconnect(delayOverride) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = delayOverride !== undefined ? delayOverride : this.reconnectBackoff;

    console.log(`[SocketService] Reconnecting in ${delay}ms...`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.isManualDisconnect || !this.shouldAutoReconnect) return;

      try {
        await this.reconnectWithAuth();
      } catch (e) {
        console.error('[SocketService] Reconnect failed:', e.message);
        // Increase backoff
        this.reconnectBackoff = Math.min(this.reconnectBackoff * 2, this.maxReconnectBackoff);
        if (this.shouldAutoReconnect && !this.isManualDisconnect) {
          this._scheduleReconnect();
        }
      }
    }, delay);
  }

  /**
   * Reconnect with auth
   */
  async reconnectWithAuth() {
    if (!this.savedUsername || !this.savedToken) {
      console.log('[SocketService] No saved credentials for reconnect');
      return false;
    }

    console.log('[SocketService] Reconnecting with auth...');

    if (!this.socket || !this.socket.connected) {
      await this.connect();
    }

    // Auth is handled automatically in the 'connect' handler
    // Wait for auth to complete
    if (this.connectionState === STATE.AUTHENTICATED) {
      return true;
    }

    // If not authenticated yet, the connect handler will handle it
    console.log('[SocketService] Reconnection initiated, auth will follow');
    return true;
  }

  /**
   * Keepalive
   */
  startKeepalive() {
    this.stopKeepalive();

    this.keepaliveInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('ping', {timestamp: Date.now()});
      }
    }, 25000);

    console.log('[SocketService] Keepalive started');
  }

  stopKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  /**
   * Disconnect
   */
  disconnect(manual = false) {
    console.log('[SocketService] Disconnect (manual:', manual, ')');

    this.isManualDisconnect = manual;
    if (manual) {
      this.shouldAutoReconnect = false;
      this.savedUsername = null;
      this.savedToken = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopKeepalive();
    this.isAuthenticating = false;

    if (this.socket) {
      this.socket.disconnect();
      if (manual) {
        try { this.socket.removeAllListeners(); } catch (e) { /* ignore */ }
        this.socket = null;
      }
    }

    this._setState(STATE.DISCONNECTED);
  }

  isConnected() {
    return this.socket?.connected || false;
  }

  getConnectionState() {
    return this.connectionState;
  }

  /**
   * Register
   */
  async register(username, password) {
    return new Promise((resolve, reject) => {
      this.socket.emit('register', {username, password});

      const timeout = setTimeout(() => {
        reject(new Error('Таймаут регистрации'));
      }, 10000);

      this.socket.once('register_success', async (data) => {
        clearTimeout(timeout);

        this.savedUsername = data.username;
        this.savedToken = data.token;
        this.shouldAutoReconnect = true;
        this._setState(STATE.AUTHENTICATED);

        await AsyncStorage.setItem('username', data.username);
        await AsyncStorage.setItem('token', data.token);

        // Duplicate to native SharedPreferences for BootReceiver
        if (NativeStorage) {
          try {
            await NativeStorage.saveCredentials(data.username, data.token);
          } catch (e) {
            console.warn('[SocketService] NativeStorage save failed:', e.message);
          }
        }

        console.log('[SocketService] Registration successful');
        resolve(data);
      });

      this.socket.once('register_error', (data) => {
        clearTimeout(timeout);
        reject(new Error(data.message));
      });
    });
  }

  /**
   * Login
   */
  async login(username, password) {
    return new Promise((resolve, reject) => {
      this.socket.emit('login', {username, password});

      const timeout = setTimeout(() => {
        reject(new Error('Таймаут входа'));
      }, 10000);

      this.socket.once('login_success', async (data) => {
        clearTimeout(timeout);

        this.savedUsername = data.username;
        this.savedToken = data.token;
        this.shouldAutoReconnect = true;
        this._setState(STATE.AUTHENTICATED);

        await AsyncStorage.setItem('username', data.username);
        await AsyncStorage.setItem('token', data.token);

        // Duplicate to native SharedPreferences for BootReceiver
        if (NativeStorage) {
          try {
            await NativeStorage.saveCredentials(data.username, data.token);
          } catch (e) {
            console.warn('[SocketService] NativeStorage save failed:', e.message);
          }
        }

        console.log('[SocketService] Login successful');
        resolve(data);
      });

      this.socket.once('login_error', (data) => {
        clearTimeout(timeout);
        reject(new Error(data.message));
      });
    });
  }

  /**
   * Token auth — with isAuthenticating guard to prevent race conditions
   */
  async authenticateWithToken(username, token) {
    if (this.isAuthenticating) {
      console.log('[SocketService] Auth already in progress, waiting...');
      // Wait for current auth to finish
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (!this.isAuthenticating) {
            clearInterval(checkInterval);
            if (this.connectionState === STATE.AUTHENTICATED) {
              resolve({username});
            } else {
              reject(new Error('Предыдущая авторизация не удалась'));
            }
          }
        }, 200);
        setTimeout(() => {
          clearInterval(checkInterval);
          reject(new Error('Таймаут ожидания авторизации'));
        }, 15000);
      });
    }

    this.isAuthenticating = true;
    this._setState(STATE.AUTHENTICATING);

    return new Promise((resolve, reject) => {
      // FIX: Don't check socket.connected here directly — we are called from
      // the 'connect' handler, so the socket IS connected. The previous bug
      // was that after 'io server disconnect' the re-auth fired before the
      // state was fully consistent.
      if (!this.socket) {
        this.isAuthenticating = false;
        this._setState(STATE.DISCONNECTED);
        reject(new Error('Нет подключения к серверу'));
        return;
      }

      this.socket.emit('auth_token', {username, token});

      const cleanup = () => {
        clearTimeout(authTimeout);
        this.socket?.off('disconnect', onDisconnect);
      };

      const authTimeout = setTimeout(() => {
        cleanup();
        this.isAuthenticating = false;
        if (this.socket?.connected) {
          this._setState(STATE.CONNECTED);
        } else {
          this._setState(STATE.DISCONNECTED);
        }
        reject(new Error('Таймаут авторизации'));
      }, 10000);

      // If we disconnect during auth, cancel
      const onDisconnect = () => {
        cleanup();
        this.isAuthenticating = false;
        this._setState(STATE.DISCONNECTED);
        reject(new Error('Отключено во время авторизации'));
      };
      this.socket.once('disconnect', onDisconnect);

      this.socket.once('auth_success', (data) => {
        cleanup();
        this.isAuthenticating = false;

        this.savedUsername = username;
        this.savedToken = token;
        this.shouldAutoReconnect = true;
        this._setState(STATE.AUTHENTICATED);

        // Flush pending FCM token if any
        if (this._pendingFcmToken) {
          this.socket.emit('register_fcm_token', this._pendingFcmToken);
          console.log('[SocketService] Deferred FCM token sent');
          this._pendingFcmToken = null;
        }

        console.log('[SocketService] Token auth successful');
        resolve(data);
      });

      this.socket.once('auth_error', (data) => {
        cleanup();
        this.isAuthenticating = false;
        this._setState(STATE.CONNECTED);
        console.error('[SocketService] Auth error:', data.message);
        reject(new Error(data.message));
      });
    });
  }

  /**
   * Register FCM token
   */
  registerFCMToken(username, fcmToken, platform) {
    if (this.socket?.connected) {
      console.log('[SocketService] Registering FCM token');
      this.socket.emit('register_fcm_token', {username, fcmToken, platform});
      this._pendingFcmToken = null;
    } else {
      console.warn('[SocketService] Not connected - FCM token deferred');
      this._pendingFcmToken = {username, fcmToken, platform};
    }

    // Also save to native SharedPreferences for BootReceiver / token refresh
    if (NativeStorage && fcmToken) {
      NativeStorage.saveFcmToken(fcmToken).catch(e =>
        console.warn('[SocketService] NativeStorage FCM save failed:', e.message)
      );
    }
  }

  logout() {
    if (this.socket?.connected) {
      this.socket.emit('logout');
    }

    this.shouldAutoReconnect = false;
    this.savedUsername = null;
    this.savedToken = null;
    this.isAuthenticating = false;
    this._setState(STATE.DISCONNECTED);

    // Clear native SharedPreferences
    if (NativeStorage) {
      NativeStorage.clearCredentials().catch(e =>
        console.warn('[SocketService] NativeStorage clear failed:', e.message)
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CALLS
  // ═══════════════════════════════════════════════════════════
  makeCall(to, isVideo) {
    if (!this.socket?.connected) {
      console.error('[SocketService] Not connected - cannot call');
      return false;
    }

    this.socket.emit('call', {to, isVideo});
    console.log('[SocketService] -> Call:', to);
    return true;
  }

  acceptCall(from, callId) {
    if (!this.socket?.connected) {
      console.error('[SocketService] Not connected');
      return false;
    }

    this.socket.emit('accept_call', {from, callId});
    console.log('[SocketService] -> Call accepted, callId:', callId);
    return true;
  }

  rejectCall(from, callId) {
    if (!this.socket?.connected) {
      console.error('[SocketService] Not connected');
      return false;
    }

    this.socket.emit('reject_call', {from, callId});
    console.log('[SocketService] -> Call rejected');
    return true;
  }

  endCall(to, callId) {
    if (!this.socket?.connected) {
      console.error('[SocketService] Not connected');
      return false;
    }

    this.socket.emit('end_call', {to, callId});
    console.log('[SocketService] -> Call ended, to:', to, 'callId:', callId);
    return true;
  }

  cancelCall(to, callId) {
    if (!this.socket?.connected) {
      console.error('[SocketService] Not connected');
      return false;
    }

    this.socket.emit('cancel_call', {to, callId});
    console.log('[SocketService] -> Call cancelled, callId:', callId);
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // WEBRTC
  // ═══════════════════════════════════════════════════════════
  sendWebRTCOffer(to, offer) {
    if (!this.socket?.connected) {
      console.error('[SocketService] Not connected');
      return false;
    }

    this.socket.emit('webrtc_offer', {to, offer});
    console.log('[SocketService] -> Offer sent');
    return true;
  }

  sendWebRTCAnswer(to, answer) {
    if (!this.socket?.connected) {
      console.error('[SocketService] Not connected');
      return false;
    }

    this.socket.emit('webrtc_answer', {to, answer});
    console.log('[SocketService] -> Answer sent');
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
  // USERS
  // ═══════════════════════════════════════════════════════════
  getUsers(includeOffline = true) {
    if (!this.socket?.connected) {
      console.error('[SocketService] Not connected');
      return false;
    }

    this.socket.emit('get_users', {includeOffline});
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // MESSAGES
  // ═══════════════════════════════════════════════════════════

  sendMessage(to, message, timestamp) {
    if (!this.socket?.connected) {
      console.error('[SocketService] Not connected');
      return false;
    }

    try {
      this.socket.emit('send_message', {to, message, timestamp});
      console.log('[SocketService] -> Message sent');
      return true;
    } catch (error) {
      console.error('[SocketService] Send error:', error);
      return false;
    }
  }

  getMessageHistory(withUser, limit = 100) {
    if (!this.socket?.connected) {
      console.warn('[SocketService] Not connected - cannot get history');
      return false;
    }

    this.socket.emit('get_messages', {withUser, limit});
    console.log('[SocketService] -> Message history request:', withUser);
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
  // ADMIN
  // ═══════════════════════════════════════════════════════════

  adminDeleteUser(targetUsername) {
    if (!this.socket?.connected) {
      console.error('[SocketService] Not connected');
      return false;
    }

    this.socket.emit('admin_delete_user', {targetUsername});
    console.log('[SocketService] -> Admin: delete user', targetUsername);
    return true;
  }

  adminBanUser(targetUsername, reason) {
    if (!this.socket?.connected) {
      console.error('[SocketService] Not connected');
      return false;
    }

    this.socket.emit('admin_ban_user', {targetUsername, reason});
    console.log('[SocketService] -> Admin: ban user', targetUsername);
    return true;
  }

  adminUnbanUser(targetUsername) {
    if (!this.socket?.connected) {
      console.error('[SocketService] Not connected');
      return false;
    }

    this.socket.emit('admin_unban_user', {targetUsername});
    console.log('[SocketService] -> Admin: unban user', targetUsername);
    return true;
  }

  deleteMyAccount() {
    if (!this.socket?.connected) {
      console.error('[SocketService] Not connected');
      return false;
    }

    this.socket.emit('delete_my_account');
    console.log('[SocketService] -> Delete my account');
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // EVENT SYSTEM
  // ═══════════════════════════════════════════════════════════
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  once(event, callback) {
    const wrapper = (data) => {
      this.off(event, wrapper);
      callback(data);
    };
    this.on(event, wrapper);
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
    // FIX: Iterate over a shallow copy — once() removes itself from the
    // original array via splice(), which can skip the next listener if we
    // iterate the live array.
    const callbacks = [...this.listeners.get(event)];
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[SocketService] Error in handler ${event}:`, error);
      }
    });
  }

  /**
   * Wait for the socket to reach AUTHENTICATED state.
   * Resolves immediately if already authenticated.
   * Rejects on timeout.
   */
  waitForAuthentication(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (this.connectionState === STATE.AUTHENTICATED) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        this.off('connection_state', onState);
        reject(new Error('Timeout waiting for authentication'));
      }, timeoutMs);

      const onState = (state) => {
        if (state === STATE.AUTHENTICATED) {
          clearTimeout(timer);
          this.off('connection_state', onState);
          resolve();
        }
      };

      this.on('connection_state', onState);
    });
  }

  cleanup() {
    this.disconnect(true);
  }
}

export default new SocketService();
