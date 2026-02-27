/**
 * Конфигурация подключения к серверу SecureCall
 * URL сервера: https://call.n8n-auto.space
 * 
 * ВАЖНО: URL захардкожен и не может быть изменен без пересборки приложения
 */

// ЗАХАРДКОЖЕННЫЙ URL СЕРВЕРА
export const SERVER_URL = 'https://call.n8n-auto.space';
export const WS_URL = 'wss://call.n8n-auto.space';
export const HTTP_URL = 'https://call.n8n-auto.space';

// Определение платформы
import {Platform} from 'react-native';
const currentPlatform = Platform.OS; // 'android', 'ios', 'windows'

// Конфигурация Socket.IO
export const SOCKET_CONFIG = {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity, // [FIX] was 10 — must be Infinity for reliable reconnect
  transports: ['websocket', 'polling'],
  timeout: 20000,
  forceNew: false,
  autoConnect: true,
  query: {
    platform: currentPlatform,
  },
};

// Конфигурация WebRTC
export const WEBRTC_CONFIG = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
    // Добавьте TURN сервер, если необходимо
    // {
    //   urls: 'turn:your-turn-server.com:3478',
    //   username: 'username',
    //   credential: 'password',
    // },
  ],
  iceCandidatePoolSize: 10,
};

// Таймауты
export const TIMEOUTS = {
  CALL_TIMEOUT: 60000, // 60 секунд
  RECONNECT_TIMEOUT: 5000, // 5 секунд
  MESSAGE_TIMEOUT: 30000, // 30 секунд
};

// Логирование конфигурации
console.log('🌐 SecureCall Configuration:');
console.log('   Server URL:', SERVER_URL);
console.log('   WebSocket URL:', WS_URL);
console.log('   HTTP URL:', HTTP_URL);

export default {
  SERVER_URL,
  WS_URL,
  HTTP_URL,
  SOCKET_CONFIG,
  WEBRTC_CONFIG,
  TIMEOUTS,
};