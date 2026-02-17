/**
 * Конфигурация SecureCall
 * Файл: config.js (в корне проекта)
 * 
 * ВАЖНО: Этот файл содержит захардкоженные URL сервера
 */

// URL сервера - ЗАХАРДКОЖЕН
export const SERVER_URL = 'https://call.n8n-auto.space';

// Конфигурация сервера
export const SERVER_CONFIG = {
  // Основной URL
  url: SERVER_URL,
  
  // Socket.IO настройки
  socketOptions: {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    timeout: 10000,
    autoConnect: false,
  },
  
  // Таймауты
  timeouts: {
    connection: 10000,
    call: 30000,
    reconnect: 5000,
  },
};

// WebRTC конфигурация для P2P
export const WEBRTC_CONFIG = {
  // ICE серверы для NAT traversal
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
  
  // Размер пула ICE candidates
  iceCandidatePoolSize: 10,
  
  // Настройки DTLS (шифрование)
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

// Медиа constraints для аудио/видео
export const MEDIA_CONSTRAINTS = {
  // Аудио звонок
  audio: {
    audio: true,
    video: false,
  },
  
  // Видео звонок
  video: {
    audio: true,
    video: {
      width: { min: 640, ideal: 1280, max: 1920 },
      height: { min: 480, ideal: 720, max: 1080 },
      frameRate: { min: 15, ideal: 30, max: 30 },
      facingMode: 'user',
    },
  },
};

// Константы приложения
export const APP_CONSTANTS = {
  APP_NAME: 'SecureCall',
  APP_VERSION: '1.0.0',
  
  // Storage keys
  STORAGE_KEYS: {
    USERNAME: 'username',
    AUTH_TOKEN: 'auth_token',
    USER_SETTINGS: 'user_settings',
  },
  
  // Лимиты
  MAX_USERNAME_LENGTH: 20,
  MIN_USERNAME_LENGTH: 3,
  MIN_PASSWORD_LENGTH: 6,
};

// Экспорт по умолчанию
export default {
  SERVER_URL,
  SERVER_CONFIG,
  WEBRTC_CONFIG,
  MEDIA_CONSTRAINTS,
  APP_CONSTANTS,
};
