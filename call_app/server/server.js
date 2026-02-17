// server.js - ПОЛНАЯ ВЕРСИЯ v8.0.0 (Signal Architecture + Critical Bug Fixes)
// CHANGELOG v8.0.0:
// - [FIX] end_call теперь отправляется только конкретному собеседнику, а не всем (broadcast bug)
// - [FIX] call_initiated событие отправляется звонящему с callId (для корректного завершения)
// - [FIX] generateToken() использует crypto.randomBytes() вместо Math.random() (Signal-style)
// - [FIX] Admin session expiry (1 час TTL)
// - [NEW] /webrtc-config endpoint с поддержкой TURN серверов (Signal-inspired HMAC credentials)
// - [SECURITY] Hardened token generation
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: process.env.CORS_ORIGINS || '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  pingTimeout: parseInt(process.env.WS_PING_TIMEOUT) || 60000,
  pingInterval: parseInt(process.env.WS_PING_INTERVAL) || 25000,
});

const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');

// Подключение к базе данных
const { connectDatabase, getDatabaseStats } = require('./config/database');
const firebaseService = require('./services/firebase');

// Модели
const User = require('./models/User');
const Message = require('./models/Message');

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Для админ панели
}));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Логирование запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Хранилище активных сессий (в памяти)
const activeSessions = new Map(); // socketId -> { username, token, isAdmin }
const onlineUsers = new Map(); // username -> socketId
const adminSessions = new Map(); // sessionId -> { authenticated: true, username, timestamp }

// ═══════════════════════════════════════════════════════════════════════════════
// НОВОЕ v7.2: Отслеживание активных звонков
// ═══════════════════════════════════════════════════════════════════════════════
const activeCalls = new Map(); // callId -> { from, to, isVideo, timestamp, status, timeoutId }

// Таймаут для автоматического missed call (30 секунд)
const CALL_TIMEOUT_MS = 30000;

console.log('╔═══════════════════════════════════╗');
console.log('║  SecureCall Server v7.2.1 FULL   ║');
console.log('║  + Admin Panel                    ║');
console.log('║  + Auto Missed Call Detection     ║');
console.log('║  + Fixed UI (no overflow, rays)   ║');
console.log('╚═══════════════════════════════════╝');

// =============================================================================
// HTTP ENDPOINTS
// =============================================================================

// =============================================================================
// TURN CREDENTIAL GENERATION (Signal-inspired HMAC approach)
// =============================================================================

/**
 * Генерирует временные TURN credentials по алгоритму как у Signal/Coturn
 * Переменные окружения:
 *   TURN_URL       — адрес TURN сервера (turn:your-server.com:3478)
 *   TURN_SECRET    — общий секрет для HMAC (если используется HMAC auth)
 *   TURN_USERNAME  — статический логин (альтернатива HMAC)
 *   TURN_PASSWORD  — статический пароль (альтернатива HMAC)
 */
function generateTurnCredentials(username = 'securecall') {
  const secret = process.env.TURN_SECRET;
  if (!secret) return null;
  const ttlSeconds = 86400; // 24 часа
  const timestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const turnUsername = `${timestamp}:${username}`;
  const hmac = crypto.createHmac('sha1', secret);
  hmac.update(turnUsername);
  const credential = hmac.digest('base64');
  return { username: turnUsername, credential };
}

// =============================================================================
// WEBRTC CONFIG ENDPOINT (Signal-inspired: server delivers ICE config)
// =============================================================================

app.get('/webrtc-config', (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ];

  const turnUrl = process.env.TURN_URL;
  if (turnUrl) {
    if (process.env.TURN_SECRET) {
      // HMAC-based (Coturn/Signal-style)
      const creds = generateTurnCredentials();
      if (creds) {
        iceServers.push({
          urls: turnUrl,
          username: creds.username,
          credential: creds.credential,
        });
      }
    } else if (process.env.TURN_USERNAME) {
      // Static credentials
      iceServers.push({
        urls: turnUrl,
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_PASSWORD || '',
      });
    }
  }

  res.json({ iceServers });
});

app.get('/health', async (req, res) => {
  const stats = await getDatabaseStats();
  res.json({
    status: 'ok',
    version: '7.2.1-FULL',
    timestamp: new Date().toISOString(),
    online: onlineUsers.size,
    activeCalls: activeCalls.size,
    firebase: firebaseService.isReady(),
    database: stats,
  });
});

app.get('/stats', async (req, res) => {
  const stats = await getDatabaseStats();
  res.json({
    ...stats,
    activeSessions: activeSessions.size,
    onlineUsers: Array.from(onlineUsers.keys()),
    activeCalls: activeCalls.size,
  });
});

// =============================================================================
// АДМИН ПАНЕЛЬ - ГЛАВНАЯ СТРАНИЦА (ИСПРАВЛЕНО v7.2.1)
// =============================================================================

app.get('/', async (req, res) => {
  const stats = await getDatabaseStats();
  const totalUsers = await User.countDocuments();
  
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SecureCall - Безопасные звонки</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Segoe UI', 'Roboto', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;  /* ← ИСПРАВЛЕНИЕ v7.2.1: Полностью убрать скролл body */
            position: relative;
          }
          
          /* ЛУЧИ СОЛНЦА - ИСПРАВЛЕНО v7.2.1 */
          .sun-rays {
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            /* ИСПРАВЛЕНИЕ v7.2.1: Линейный градиент из top-left в bottom-right (135deg) */
            background: 
              repeating-linear-gradient(
                135deg,
                rgba(255, 255, 255, 0.15) 0px,
                transparent 2px,
                transparent 4px,
                rgba(255, 255, 255, 0.08) 6px
              );
            /* ИСПРАВЛЕНИЕ v7.2.1: Пульсация вместо вращения */
            animation: rays-pulse 4s ease-in-out infinite;
            pointer-events: none;
          }
          
          /* ИСПРАВЛЕНИЕ v7.2.1: Новая анимация пульсации для лучей */
          @keyframes rays-pulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 0.9; }
          }
          
          /* СОЛНЕЧНОЕ СВЕЧЕНИЕ */
          .sun-glow {
            position: absolute;
            top: -100px;
            left: -100px;
            width: 400px;
            height: 400px;
            background: radial-gradient(
              circle,
              rgba(255, 255, 255, 0.3) 0%,
              rgba(255, 255, 255, 0.15) 30%,
              transparent 70%
            );
            border-radius: 50%;
            pointer-events: none;
            animation: pulse 4s ease-in-out infinite;
          }
          
          @keyframes pulse {
            0%, 100% { opacity: 0.6; transform: scale(1); }
            50% { opacity: 0.8; transform: scale(1.1); }
          }
          
          .container {
            position: relative;
            z-index: 10;
            background: rgba(255, 255, 255, 0.95);
            max-width: 900px;
            width: 90%;
            margin: 20px;
            padding: 60px 40px;
            border-radius: 30px;
            box-shadow: 
              0 20px 60px rgba(0, 0, 0, 0.3),
              0 0 100px rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            animation: slideIn 0.6s ease-out;
            /* ИСПРАВЛЕНИЕ v7.2.1: Добавить ограничение высоты и внутренний скролл */
            max-height: calc(100vh - 40px);
            overflow-y: auto;
            overflow-x: hidden;
          }
          
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          
          .header {
            text-align: center;
            margin-bottom: 40px;
          }
          
          .logo {
            font-size: 80px;
            margin-bottom: 20px;
            animation: bounce 2s ease-in-out infinite;
          }
          
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }
          
          h1 {
            font-size: 48px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 10px;
            font-weight: 800;
          }
          
          .tagline {
            font-size: 20px;
            color: #666;
            font-weight: 400;
          }
          
          .status-card {
            background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
            padding: 30px;
            border-radius: 20px;
            margin: 30px 0;
            border: 2px solid rgba(102, 126, 234, 0.2);
          }
          
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 20px;
          }
          
          .stat-item {
            text-align: center;
            padding: 20px;
            background: white;
            border-radius: 15px;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
            transition: transform 0.3s ease;
          }
          
          .stat-item:hover {
            transform: translateY(-5px);
          }
          
          .stat-icon {
            font-size: 40px;
            margin-bottom: 10px;
          }
          
          .stat-value {
            font-size: 36px;
            font-weight: 700;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 5px;
          }
          
          .stat-label {
            font-size: 14px;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          
          .admin-section {
            text-align: center;
            margin: 40px 0;
            padding: 30px;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            border-radius: 20px;
            color: white;
          }
          
          .admin-title {
            font-size: 28px;
            margin-bottom: 15px;
            font-weight: 700;
          }
          
          .admin-button {
            display: inline-block;
            background: white;
            color: #f5576c;
            padding: 15px 35px;
            border-radius: 50px;
            text-decoration: none;
            font-size: 18px;
            font-weight: 700;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
            transition: all 0.3s ease;
            margin: 10px;
            cursor: pointer;
            border: none;
          }
          
          .admin-button:hover {
            transform: translateY(-3px);
            box-shadow: 0 15px 40px rgba(0, 0, 0, 0.3);
          }
          
          .download-section {
            text-align: center;
            margin-top: 40px;
            padding: 40px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 20px;
            color: white;
          }
          
          .download-title {
            font-size: 32px;
            margin-bottom: 15px;
            font-weight: 700;
          }
          
          .download-subtitle {
            font-size: 18px;
            margin-bottom: 30px;
            opacity: 0.9;
          }
          
          .download-button {
            display: inline-block;
            background: white;
            color: #667eea;
            padding: 18px 40px;
            border-radius: 50px;
            text-decoration: none;
            font-size: 18px;
            font-weight: 700;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
            transition: all 0.3s ease;
            margin: 10px;
          }
          
          .download-button:hover {
            transform: translateY(-3px);
            box-shadow: 0 15px 40px rgba(0, 0, 0, 0.3);
          }
          
          .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin: 40px 0;
          }
          
          .feature {
            padding: 25px;
            background: white;
            border-radius: 15px;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
            text-align: center;
          }
          
          .feature-icon {
            font-size: 50px;
            margin-bottom: 15px;
          }
          
          .feature-title {
            font-size: 18px;
            font-weight: 700;
            color: #333;
            margin-bottom: 10px;
          }
          
          .feature-desc {
            font-size: 14px;
            color: #666;
            line-height: 1.6;
          }
          
          .footer {
            text-align: center;
            margin-top: 40px;
            padding-top: 30px;
            border-top: 2px solid rgba(102, 126, 234, 0.1);
            color: #666;
            font-size: 14px;
          }
          
          .version-badge {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 8px 20px;
            border-radius: 50px;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 20px;
          }
          
          @media (max-width: 768px) {
            .container {
              padding: 40px 20px;
            }
            
            h1 {
              font-size: 36px;
            }
            
            .logo {
              font-size: 60px;
            }
            
            .download-title {
              font-size: 24px;
            }
            
            .stats-grid,
            .features {
              grid-template-columns: 1fr;
            }
          }
        </style>
      </head>
      <body>
        <!-- Лучи солнца - ИСПРАВЛЕНО v7.2.1 -->
        <div class="sun-rays"></div>
        <div class="sun-glow"></div>
        
        <div class="container">
          <div class="header">
            <div class="logo">📞</div>
            <h1>SecureCall</h1>
            <p class="tagline">Безопасные звонки и чаты</p>
            <div class="version-badge">v7.2.1 Full Final</div>
          </div>
          
          <div class="status-card">
            <div class="stats-grid">
              <div class="stat-item">
                <div class="stat-icon">✅</div>
                <div class="stat-value">Работает</div>
                <div class="stat-label">Статус</div>
              </div>
              
              <div class="stat-item">
                <div class="stat-icon">👥</div>
                <div class="stat-value">${onlineUsers.size}</div>
                <div class="stat-label">Онлайн</div>
              </div>
              
              <div class="stat-item">
                <div class="stat-icon">📊</div>
                <div class="stat-value">${totalUsers}</div>
                <div class="stat-label">Пользователей</div>
              </div>
            </div>
          </div>
          
          <!-- АДМИН ПАНЕЛЬ -->
          <div class="admin-section">
            <div class="admin-title">👑 Панель администратора</div>
            <p style="margin-bottom: 20px; opacity: 0.9;">Управление пользователями и сервером</p>
            <a href="/admin" class="admin-button">Войти в админ панель</a>
          </div>
          
          <div class="features">
            <div class="feature">
              <div class="feature-icon">📹</div>
              <div class="feature-title">Видеозвонки</div>
              <div class="feature-desc">Кристально чистое видео в высоком качестве</div>
            </div>
            
            <div class="feature">
              <div class="feature-icon">💬</div>
              <div class="feature-title">Чаты</div>
              <div class="feature-desc">Быстрый обмен сообщениями с историей</div>
            </div>
            
            <div class="feature">
              <div class="feature-icon">🔒</div>
              <div class="feature-title">Безопасность</div>
              <div class="feature-desc">Защищенное соединение по WebRTC</div>
            </div>
            
            <div class="feature">
              <div class="feature-icon">🔔</div>
              <div class="feature-title">Уведомления</div>
              <div class="feature-desc">Push-уведомления о звонках и сообщениях</div>
            </div>
          </div>
          
          <div class="download-section">
            <div class="download-title">🎉 Скачай приложение!</div>
            <div class="download-subtitle">Доступно для Android устройств</div>
            <a href="/download/SecureCall-v7.2.apk" class="download-button">
              📱 Скачать для Android
            </a>
            <div style="margin-top: 20px; font-size: 14px; opacity: 0.8;">
              Версия 7.2.1 • Размер ~25 МБ • Android 8.0+
            </div>
          </div>
          
          <div class="footer">
            <p><strong>SecureCall Server v7.2.1 Full</strong></p>
            <p>Защищенные звонки и чаты • ${new Date().getFullYear()}</p>
          </div>
        </div>
      </body>
    </html>
  `);
});

// =============================================================================
// АДМИН ПАНЕЛЬ - СТРАНИЦА ВХОДА И УПРАВЛЕНИЯ
// =============================================================================

app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SecureCall - Админ панель</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Segoe UI', 'Roboto', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
          }
          
          .container {
            max-width: 1200px;
            margin: 0 auto;
          }
          
          .header {
            text-align: center;
            color: white;
            margin-bottom: 40px;
          }
          
          .header h1 {
            font-size: 48px;
            margin-bottom: 10px;
          }
          
          .header p {
            font-size: 18px;
            opacity: 0.9;
          }
          
          .admin-card {
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            margin-bottom: 30px;
          }
          
          .login-form {
            max-width: 400px;
            margin: 0 auto;
          }
          
          .form-group {
            margin-bottom: 20px;
          }
          
          .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
          }
          
          .form-group input {
            width: 100%;
            padding: 12px 20px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 16px;
            transition: border 0.3s;
          }
          
          .form-group input:focus {
            outline: none;
            border-color: #667eea;
          }
          
          .btn {
            width: 100%;
            padding: 15px;
            border: none;
            border-radius: 10px;
            font-size: 18px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.3s;
          }
          
          .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          
          .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
          }
          
          .btn-danger {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
          }
          
          .btn-danger:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(245, 87, 108, 0.4);
          }
          
          .btn-success {
            background: linear-gradient(135deg, #56ab2f 0%, #a8e063 100%);
            color: white;
          }
          
          .btn-success:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(86, 171, 47, 0.4);
          }
          
          .error-message {
            background: #fee;
            color: #c00;
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 20px;
            text-align: center;
          }
          
          .success-message {
            background: #efe;
            color: #0a0;
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 20px;
            text-align: center;
          }
          
          .hidden {
            display: none !important;
          }
          
          .users-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }
          
          .users-table th,
          .users-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e0e0e0;
          }
          
          .users-table th {
            background: #f5f5f5;
            font-weight: 600;
          }
          
          .users-table tr:hover {
            background: #f9f9f9;
          }
          
          .badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
          }
          
          .badge-online {
            background: #e6f4ea;
            color: #0d652d;
          }
          
          .badge-offline {
            background: #fce8e6;
            color: #a50e0e;
          }
          
          .badge-admin {
            background: #e8eaf6;
            color: #3949ab;
          }
          
          .badge-banned {
            background: #ffe6e6;
            color: #d32f2f;
          }
          
          .action-buttons {
            display: flex;
            gap: 10px;
          }
          
          .btn-small {
            padding: 6px 12px;
            font-size: 14px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            transition: all 0.3s;
          }
          
          .btn-small.btn-delete {
            background: #f5576c;
            color: white;
          }
          
          .btn-small.btn-ban {
            background: #ff9800;
            color: white;
          }
          
          .btn-small.btn-unban {
            background: #4caf50;
            color: white;
          }
          
          .btn-small:hover {
            opacity: 0.8;
            transform: translateY(-1px);
          }
          
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
          }
          
          .stat-card {
            background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
            padding: 20px;
            border-radius: 15px;
            text-align: center;
          }
          
          .stat-card .value {
            font-size: 36px;
            font-weight: 700;
            color: #667eea;
            margin-bottom: 5px;
          }
          
          .stat-card .label {
            font-size: 14px;
            color: #666;
            text-transform: uppercase;
          }
          
          .back-link {
            display: inline-block;
            color: white;
            text-decoration: none;
            margin-bottom: 20px;
            font-weight: 600;
          }
          
          .back-link:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <a href="/" class="back-link">← Вернуться на главную</a>
          
          <div class="header">
            <h1>👑 Админ панель</h1>
            <p>Управление пользователями SecureCall</p>
          </div>
          
          <!-- ФОРМА ВХОДА -->
          <div id="loginSection" class="admin-card">
            <div class="login-form">
              <h2 style="text-align: center; margin-bottom: 30px;">Вход в админ панель</h2>
              
              <div id="loginError" class="error-message hidden"></div>
              
              <form id="loginForm">
                <div class="form-group">
                  <label for="adminPassword">Пароль администратора:</label>
                  <input type="password" id="adminPassword" placeholder="Введите пароль" required>
                </div>
                
                <button type="submit" class="btn btn-primary">Войти</button>
              </form>
            </div>
          </div>
          
          <!-- ПАНЕЛЬ УПРАВЛЕНИЯ -->
          <div id="adminPanel" class="hidden">
            <div class="admin-card">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2>📊 Статистика сервера</h2>
                <button onclick="logout()" class="btn-small btn-delete">Выйти</button>
              </div>
              
              <div class="stats-grid">
                <div class="stat-card">
                  <div class="value" id="statTotal">0</div>
                  <div class="label">Всего пользователей</div>
                </div>
                <div class="stat-card">
                  <div class="value" id="statOnline">0</div>
                  <div class="label">Онлайн</div>
                </div>
                <div class="stat-card">
                  <div class="value" id="statBanned">0</div>
                  <div class="label">Заблокировано</div>
                </div>
              </div>
            </div>
            
            <div class="admin-card">
              <h2 style="margin-bottom: 20px;">👥 Управление пользователями</h2>
              
              <div id="actionMessage" class="hidden"></div>
              
              <button onclick="loadUsers()" class="btn btn-primary" style="margin-bottom: 20px;">
                🔄 Обновить список
              </button>
              
              <table class="users-table">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Статус</th>
                    <th>Роль</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody id="usersTableBody">
                  <tr>
                    <td colspan="4" style="text-align: center; padding: 40px;">
                      Загрузка данных...
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
        <script>
          let sessionId = null;
          
          // Вход в админ панель
          document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const password = document.getElementById('adminPassword').value;
            const errorDiv = document.getElementById('loginError');
            
            try {
              const response = await fetch('/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
              });
              
              const data = await response.json();
              
              if (data.success) {
                sessionId = data.sessionId;
                document.getElementById('loginSection').classList.add('hidden');
                document.getElementById('adminPanel').classList.remove('hidden');
                loadUsers();
              } else {
                errorDiv.textContent = data.message || 'Неверный пароль';
                errorDiv.classList.remove('hidden');
              }
            } catch (error) {
              errorDiv.textContent = 'Ошибка подключения к серверу';
              errorDiv.classList.remove('hidden');
            }
          });
          
          // Загрузка списка пользователей
          async function loadUsers() {
            try {
              const response = await fetch('/admin/users', {
                headers: { 'X-Admin-Session': sessionId }
              });
              
              const data = await response.json();
              
              if (!data.success) {
                alert('Сессия истекла, необходимо войти заново');
                logout();
                return;
              }
              
              // Обновляем статистику
              document.getElementById('statTotal').textContent = data.users.length;
              document.getElementById('statOnline').textContent = data.users.filter(u => u.isOnline).length;
              document.getElementById('statBanned').textContent = data.users.filter(u => u.isBanned).length;
              
              // Заполняем таблицу
              const tbody = document.getElementById('usersTableBody');
              tbody.innerHTML = '';
              
              if (data.users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px;">Нет пользователей</td></tr>';
                return;
              }
              
              data.users.forEach(user => {
                const tr = document.createElement('tr');
                
                const statusBadge = user.isOnline 
                  ? '<span class="badge badge-online">🟢 Онлайн</span>' 
                  : '<span class="badge badge-offline">⚫ Оффлайн</span>';
                
                const adminBadge = user.isAdmin 
                  ? '<span class="badge badge-admin">👑 Админ</span>' 
                  : '';
                
                const bannedBadge = user.isBanned 
                  ? '<span class="badge badge-banned">🚫 Забанен</span>' 
                  : '';
                
                const actionButtons = user.isBanned
                  ? \`<button class="btn-small btn-unban" onclick="unbanUser('\${user.username}')">Разбанить</button>\`
                  : \`<button class="btn-small btn-ban" onclick="banUser('\${user.username}')">Забанить</button>\`;
                
                tr.innerHTML = \`
                  <td><strong>\${user.username}</strong></td>
                  <td>\${statusBadge} \${bannedBadge}</td>
                  <td>\${adminBadge || '-'}</td>
                  <td>
                    <div class="action-buttons">
                      \${actionButtons}
                      <button class="btn-small btn-delete" onclick="deleteUser('\${user.username}')">Удалить</button>
                    </div>
                  </td>
                \`;
                
                tbody.appendChild(tr);
              });
            } catch (error) {
              console.error('Ошибка загрузки пользователей:', error);
              alert('Ошибка загрузки данных');
            }
          }
          
          // Удаление пользователя
          async function deleteUser(username) {
            if (!confirm(\`Вы уверены, что хотите удалить пользователя "\${username}"?\\n\\nВсе данные пользователя будут безвозвратно удалены!\`)) {
              return;
            }
            
            try {
              const response = await fetch('/admin/user/delete', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Admin-Session': sessionId
                },
                body: JSON.stringify({ username })
              });
              
              const data = await response.json();
              
              if (data.success) {
                showMessage(\`Пользователь "\${username}" успешно удален\`, 'success');
                loadUsers();
              } else {
                showMessage(data.message || 'Ошибка удаления', 'error');
              }
            } catch (error) {
              showMessage('Ошибка подключения к серверу', 'error');
            }
          }
          
          // Бан пользователя
          async function banUser(username) {
            const reason = prompt(\`Укажите причину бана для "\${username}":\`, 'Нарушение правил');
            
            if (!reason) return;
            
            try {
              const response = await fetch('/admin/user/ban', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Admin-Session': sessionId
                },
                body: JSON.stringify({ username, reason })
              });
              
              const data = await response.json();
              
              if (data.success) {
                showMessage(\`Пользователь "\${username}" заблокирован\`, 'success');
                loadUsers();
              } else {
                showMessage(data.message || 'Ошибка блокировки', 'error');
              }
            } catch (error) {
              showMessage('Ошибка подключения к серверу', 'error');
            }
          }
          
          // Разбан пользователя
          async function unbanUser(username) {
            if (!confirm(\`Разблокировать пользователя "\${username}"?\`)) {
              return;
            }
            
            try {
              const response = await fetch('/admin/user/unban', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Admin-Session': sessionId
                },
                body: JSON.stringify({ username })
              });
              
              const data = await response.json();
              
              if (data.success) {
                showMessage(\`Пользователь "\${username}" разблокирован\`, 'success');
                loadUsers();
              } else {
                showMessage(data.message || 'Ошибка разблокировки', 'error');
              }
            } catch (error) {
              showMessage('Ошибка подключения к серверу', 'error');
            }
          }
          
          // Показ сообщения
          function showMessage(text, type) {
            const div = document.getElementById('actionMessage');
            div.textContent = text;
            div.className = type === 'success' ? 'success-message' : 'error-message';
            div.classList.remove('hidden');
            
            setTimeout(() => {
              div.classList.add('hidden');
            }, 3000);
          }
          
          // Выход
          function logout() {
            sessionId = null;
            document.getElementById('loginSection').classList.remove('hidden');
            document.getElementById('adminPanel').classList.add('hidden');
            document.getElementById('adminPassword').value = '';
          }
        </script>
      </body>
    </html>
  `);
});

// =============================================================================
// АДМИН API ENDPOINTS
// =============================================================================

// Проверка и валидация admin session (с TTL)
function isValidAdminSession(sessionId) {
  if (!adminSessions.has(sessionId)) return false;
  const session = adminSessions.get(sessionId);
  if (Date.now() > session.expiresAt) {
    adminSessions.delete(sessionId);
    return false;
  }
  return true;
}

// Вход в админ панель
app.post('/admin/login', (req, res) => {
  const { password } = req.body;

  const adminPassword = process.env.ADMIN_PASSWORD || 'Rtex';
  if (password !== adminPassword) {
    return res.json({
      success: false,
      message: 'Неверный пароль администратора'
    });
  }

  // Создаем сессию с TTL 1 час
  const sessionId = generateToken();
  adminSessions.set(sessionId, {
    authenticated: true,
    username: 'admin',
    timestamp: Date.now(),
    expiresAt: Date.now() + 3600000, // 1 час
  });
  
  console.log('[Admin] ✅ Успешный вход в админ панель');
  
  res.json({
    success: true,
    sessionId
  });
});

// Получение списка пользователей
app.get('/admin/users', async (req, res) => {
  const sessionId = req.headers['x-admin-session'];

  if (!isValidAdminSession(sessionId)) {
    return res.json({ success: false, message: 'Не авторизован' });
  }
  
  try {
    const users = await User.find({})
      .select('username isOnline isAdmin isBanned banReason lastSeen')
      .sort({ isOnline: -1, username: 1 })
      .lean();
    
    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('[Admin] Ошибка получения пользователей:', error);
    res.json({ success: false, message: 'Ошибка сервера' });
  }
});

// Удаление пользователя
app.post('/admin/user/delete', async (req, res) => {
  const sessionId = req.headers['x-admin-session'];

  if (!isValidAdminSession(sessionId)) {
    return res.json({ success: false, message: 'Не авторизован' });
  }
  
  const { username } = req.body;
  
  try {
    // Удалить пользователя
    await User.deleteOne({ username });
    
    // Удалить все его сообщения
    await Message.deleteMany({
      $or: [{ from: username }, { to: username }]
    });
    
    // Отключить, если онлайн
    const socketId = onlineUsers.get(username);
    if (socketId) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('force_disconnect', {
          message: 'Ваш аккаунт был удален администратором'
        });
        socket.disconnect();
      }
      onlineUsers.delete(username);
      activeSessions.delete(socketId);
    }
    
    // Уведомить всех
    io.emit('user_deleted', { username });
    
    console.log(`[Admin] ✅ Пользователь ${username} удален`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Admin] Ошибка удаления пользователя:', error);
    res.json({ success: false, message: 'Ошибка удаления' });
  }
});

// Бан пользователя
app.post('/admin/user/ban', async (req, res) => {
  const sessionId = req.headers['x-admin-session'];

  if (!isValidAdminSession(sessionId)) {
    return res.json({ success: false, message: 'Не авторизован' });
  }
  
  const { username, reason } = req.body;
  
  try {
    await User.banUser(username, reason, 'admin');
    
    // Отключить, если онлайн
    const socketId = onlineUsers.get(username);
    if (socketId) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('force_disconnect', {
          message: `Вы заблокированы. Причина: ${reason}`
        });
        socket.disconnect();
      }
      onlineUsers.delete(username);
      activeSessions.delete(socketId);
    }
    
    // Уведомить всех
    io.emit('user_banned', { username, reason });
    
    console.log(`[Admin] 🚫 Пользователь ${username} заблокирован`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Admin] Ошибка блокировки:', error);
    res.json({ success: false, message: 'Ошибка блокировки' });
  }
});

// Разбан пользователя
app.post('/admin/user/unban', async (req, res) => {
  const sessionId = req.headers['x-admin-session'];

  if (!isValidAdminSession(sessionId)) {
    return res.json({ success: false, message: 'Не авторизован' });
  }
  
  const { username } = req.body;
  
  try {
    await User.unbanUser(username);
    
    // Уведомить всех
    io.emit('user_unbanned', { username });
    
    console.log(`[Admin] ✅ Пользователь ${username} разблокирован`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Admin] Ошибка разблокировки:', error);
    res.json({ success: false, message: 'Ошибка разблокировки' });
  }
});

// =============================================================================
// SOCKET.IO EVENTS
// =============================================================================

io.on('connection', (socket) => {
  console.log(`[${socket.id}] 🔌 Новое подключение`);

  // ═══════════════════════════════════════════════════════════════════════════
  // РЕГИСТРАЦИЯ И АВТОРИЗАЦИЯ
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('register', async ({ username, password }) => {
    try {
      if (!username || !password) {
        return socket.emit('register_error', { message: 'Укажите имя и пароль' });
      }
      
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return socket.emit('register_error', { message: 'Это имя уже занято' });
      }

      const user = new User({
        username,
        password,
        token: generateToken(),
        isOnline: true,
        lastSeen: new Date(),
        isAdmin: false,
      });
      await user.save();

      activeSessions.set(socket.id, {
        username: user.username,
        token: user.token,
        isAdmin: user.isAdmin,
        loginTime: new Date(),
      });
      onlineUsers.set(user.username, socket.id);

      socket.emit('register_success', {
        username: user.username,
        token: user.token,
        isAdmin: user.isAdmin,
      });
      
      broadcastUserOnline(user.username);
      await broadcastUsersList();
      
      console.log(`[${socket.id}] ✅ Регистрация: ${username}`);
    } catch (error) {
      console.error(`[${socket.id}] ❌ Ошибка регистрации:`, error);
      socket.emit('register_error', { message: 'Ошибка сервера' });
    }
  });

  socket.on('login', async ({ username, password }) => {
    try {
      const user = await User.findByCredentials(username, password);
      
      // ПРОВЕРКА БАНА
      if (user.isBanned) {
        return socket.emit('login_error', {
          message: `Вы забанены. Причина: ${user.banReason || 'Не указана'}`
        });
      }
      
      await disconnectPreviousSession(username);
      await User.setOnlineStatus(username, true);

      activeSessions.set(socket.id, {
        username: user.username,
        token: user.token,
        isAdmin: user.isAdmin,
        loginTime: new Date(),
      });
      onlineUsers.set(user.username, socket.id);

      socket.emit('login_success', {
        username: user.username,
        token: user.token,
        isAdmin: user.isAdmin,
      });
      
      broadcastUserOnline(user.username);
      await broadcastUsersList();
      
      console.log(`[${socket.id}] ✅ Вход: ${username} (Админ: ${user.isAdmin})`);
    } catch (error) {
      console.error(`[${socket.id}] ❌ Ошибка входа:`, error);
      socket.emit('login_error', { message: error.message });
    }
  });

  socket.on('auth_token', async ({ username, token }) => {
    try {
      const user = await User.findByToken(username, token);
      
      // ПРОВЕРКА БАНА
      if (user.isBanned) {
        return socket.emit('auth_error', {
          message: `Вы забанены. Причина: ${user.banReason || 'Не указана'}`
        });
      }
      
      await disconnectPreviousSession(username);
      await User.setOnlineStatus(username, true);

      activeSessions.set(socket.id, {
        username: user.username,
        token: user.token,
        isAdmin: user.isAdmin,
        loginTime: new Date(),
      });
      onlineUsers.set(user.username, socket.id);

      socket.emit('auth_success', {
        username: user.username,
        isAdmin: user.isAdmin,
      });
      
      broadcastUserOnline(user.username);
      await broadcastUsersList();
      
      console.log(`[${socket.id}] ✅ Авторизация токеном: ${username} (Админ: ${user.isAdmin})`);
    } catch (error) {
      console.error(`[${socket.id}] ❌ Ошибка авторизации:`, error);
      socket.emit('auth_error', { message: 'Недействительный токен' });
    }
  });

  socket.on('register_fcm_token', async ({ username, fcmToken, platform }) => {
    try {
      await User.updateFCMToken(username, fcmToken, platform);
      console.log(`[${socket.id}] ✅ FCM токен обновлен для ${username} (${platform})`);
    } catch (error) {
      console.error(`[${socket.id}] ❌ Ошибка обновления FCM токена:`, error);
    }
  });

  socket.on('logout', async () => {
    const session = activeSessions.get(socket.id);
    if (session) {
      await User.setOnlineStatus(session.username, false);
      onlineUsers.delete(session.username);
      activeSessions.delete(socket.id);
      broadcastUserOffline(session.username);
      await broadcastUsersList();
      console.log(`[${socket.id}] 👋 Выход: ${session.username}`);
    }
  });

  socket.on('get_users', async ({ includeOffline = true } = {}) => {
    const session = activeSessions.get(socket.id);
    if (!session) {
      return socket.emit('error', { message: 'Не авторизован' });
    }
    
    try {
      const users = await User.getAllUsers(session.username, includeOffline);
      socket.emit('users_list', users);
    } catch (error) {
      console.error(`[${socket.id}] ❌ Ошибка получения пользователей:`, error);
      socket.emit('users_list', []);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ЗВОНКИ - УЛУЧШЕННАЯ ЛОГИКА С АВТОМАТИЧЕСКИМ MISSED CALL
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('call', async ({ to, isVideo }) => {
    const session = activeSessions.get(socket.id);
    if (!session) {
      return socket.emit('error', { message: 'Не авторизован' });
    }

    const callId = generateCallId();
    
    console.log('═══════════════════════════════════════');
    console.log(`[${socket.id}] 📞 НОВЫЙ ЗВОНОК`);
    console.log(`Call ID: ${callId}`);
    console.log(`От: ${session.username}`);
    console.log(`Кому: ${to}`);
    console.log(`Видео: ${isVideo}`);
    console.log('═══════════════════════════════════════');
    
    const targetSocketId = onlineUsers.get(to);

    // Создаем запись о звонке для отслеживания
    const callData = {
      callId,
      from: session.username,
      to,
      isVideo,
      timestamp: Date.now(),
      status: 'calling', // calling, ringing, answered, rejected, cancelled, missed
    };

    if (targetSocketId) {
      // ═══════════════════════════════════════════════════════════════════════
      // ПОЛЬЗОВАТЕЛЬ ОНЛАЙН
      // ═══════════════════════════════════════════════════════════════════════
      console.log(`[${socket.id}] ✅ ${to} онлайн, отправка incoming_call`);
      
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        // Отправляем сигнал о входящем звонке
        targetSocket.emit('incoming_call', {
          callId,
          from: session.username,
          isVideo: isVideo
        });

        callData.status = 'ringing';

        // [FIX v8.0.0] Уведомляем звонящего о callId (нужно для корректного end_call)
        socket.emit('call_initiated', { callId, to });

        // Устанавливаем таймаут для автоматического missed call
        const timeoutId = setTimeout(async () => {
          const call = activeCalls.get(callId);
          
          if (call && call.status === 'ringing') {
            console.log('═══════════════════════════════════════');
            console.log(`[CallTimeout] ⏰ ТАЙМАУТ ЗВОНКА`);
            console.log(`Call ID: ${callId}`);
            console.log(`От: ${call.from} → Кому: ${call.to}`);
            console.log('═══════════════════════════════════════');
            
            // Отправить missed call уведомление
            await sendMissedCallNotification(call.to, call.from, call.isVideo);
            
            // Уведомить звонящего
            const callerSocket = io.sockets.sockets.get(socket.id);
            if (callerSocket) {
              callerSocket.emit('call_timeout', { 
                to: call.to,
                message: 'Абонент не ответил' 
              });
            }
            
            // Отменить звонок у принимающего
            const recipientSocket = io.sockets.sockets.get(targetSocketId);
            if (recipientSocket) {
              recipientSocket.emit('call_timeout', { 
                from: call.from 
              });
            }
            
            // Удалить из активных звонков
            activeCalls.delete(callId);
          }
        }, CALL_TIMEOUT_MS);
        
        callData.timeoutId = timeoutId;
      }
    } else {
      // ═══════════════════════════════════════════════════════════════════════
      // ПОЛЬЗОВАТЕЛЬ ОФФЛАЙН - ОТПРАВИТЬ PUSH
      // ═══════════════════════════════════════════════════════════════════════
      console.log(`[${socket.id}] 🔴 ${to} оффлайн, отправка Wake-Up Push`);
      
      try {
        const targetUser = await User.findOne({ username: to });
        
        if (!targetUser) {
          console.log(`[${socket.id}] ❌ Пользователь ${to} не найден`);
          return socket.emit('call_failed', {
            to,
            message: 'Пользователь не найден'
          });
        }

        if (targetUser.fcmToken && firebaseService.isReady()) {
          console.log(`[${socket.id}] 📳 Отправка Wake-Up Push для ${to}...`);
          
          // Отправляем push с максимальным приоритетом
          const pushResult = await firebaseService.sendIncomingCallPush(
            targetUser.fcmToken,
            session.username,
            isVideo
          );
          
          if (pushResult) {
            console.log(`[${socket.id}] ✅ Push отправлен успешно`);
            
            socket.emit('call_ringing_offline', {
              to,
              callId,
              message: 'Абонент не в сети, пробуждаем устройство...'
            });

            callData.status = 'push_sent';
            
            // Устанавливаем таймаут для missed call (дольше для оффлайн)
            const timeoutId = setTimeout(async () => {
              const call = activeCalls.get(callId);
              
              if (call && (call.status === 'push_sent' || call.status === 'calling')) {
                console.log(`[CallTimeout] ⏰ ОФФЛАЙН ЗВОНОК НЕ ОТВЕЧЕН - ${callId}`);
                
                // Отправить missed call уведомление
                await sendMissedCallNotification(call.to, call.from, call.isVideo);
                
                // Уведомить звонящего
                const callerSocket = io.sockets.sockets.get(socket.id);
                if (callerSocket) {
                  callerSocket.emit('call_timeout', { 
                    to: call.to,
                    message: 'Абонент недоступен' 
                  });
                }
                
                activeCalls.delete(callId);
              }
            }, CALL_TIMEOUT_MS * 2); // Удвоенный таймаут для оффлайн
            
            callData.timeoutId = timeoutId;
          } else {
            console.log(`[${socket.id}] ❌ Не удалось отправить push`);
            socket.emit('call_failed', {
              to,
              message: 'Не удалось доставить уведомление'
            });
          }
        } else {
          console.log(`[${socket.id}] ⚠️ FCM токен отсутствует или Firebase не готов`);
          socket.emit('call_failed', {
            to,
            message: 'Пользователь оффлайн и недоступен для звонка',
            offline: true
          });
        }
      } catch (error) {
        console.error(`[${socket.id}] ❌ Ошибка обработки звонка:`, error);
        socket.emit('call_failed', { to, message: 'Ошибка сервера' });
      }
    }
    
    // Сохраняем звонок в активных
    activeCalls.set(callId, callData);
    
    console.log(`[${socket.id}] 📊 Активных звонков: ${activeCalls.size}`);
  });

  socket.on('accept_call', ({ from, callId }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;

    console.log(`[${socket.id}] ✅ ${session.username} принял звонок от ${from}`);

    let resolvedCallId = callId;

    // Найти и обновить статус звонка
    if (resolvedCallId && activeCalls.has(resolvedCallId)) {
      const call = activeCalls.get(resolvedCallId);

      if (call.timeoutId) {
        clearTimeout(call.timeoutId);
        call.timeoutId = null;
      }

      call.status = 'answered';
      call.answeredAt = Date.now();

      console.log(`[${socket.id}] ⏱️ Время ответа: ${call.answeredAt - call.timestamp}ms`);
    } else {
      // Fallback: найти по участникам
      for (const [cid, call] of activeCalls.entries()) {
        if (call.from === from && call.to === session.username) {
          if (call.timeoutId) { clearTimeout(call.timeoutId); call.timeoutId = null; }
          call.status = 'answered';
          call.answeredAt = Date.now();
          resolvedCallId = cid;
          break;
        }
      }
    }

    const callerSocketId = onlineUsers.get(from);
    if (!callerSocketId) return;

    socket.emit('cancel_call_notification');

    const callerSocket = io.sockets.sockets.get(callerSocketId);
    if (callerSocket) {
      callerSocket.emit('call_accepted', { by: session.username, callId: resolvedCallId });
    }
  });

  socket.on('reject_call', ({ from, callId }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;
    
    console.log(`[${socket.id}] ❌ ${session.username} отклонил звонок от ${from}`);
    
    socket.emit('cancel_call_notification');
    
    // Найти и завершить звонок
    if (callId && activeCalls.has(callId)) {
      const call = activeCalls.get(callId);
      
      // Отменить таймаут
      if (call.timeoutId) {
        clearTimeout(call.timeoutId);
      }
      
      call.status = 'rejected';
      
      // Удалить через 5 секунд
      setTimeout(() => {
        activeCalls.delete(callId);
      }, 5000);
    }
    
    const callerSocketId = onlineUsers.get(from);
    if (callerSocketId) {
      const callerSocket = io.sockets.sockets.get(callerSocketId);
      if (callerSocket) {
        callerSocket.emit('call_rejected', { by: session.username });
      }
    }
  });

  // [FIX v8.0.0] end_call теперь отправляется ТОЛЬКО конкретному собеседнику
  // (ранее использовался socket.broadcast.emit что рассылало событие ВСЕМ пользователям)
  socket.on('end_call', ({ callId, to }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;

    console.log(`[${socket.id}] 🔵 ${session.username} завершил звонок`);

    socket.emit('cancel_call_notification');

    let peerUsername = to;

    // Найти и завершить звонок
    if (callId && activeCalls.has(callId)) {
      const call = activeCalls.get(callId);

      if (call.timeoutId) {
        clearTimeout(call.timeoutId);
      }

      call.status = 'ended';
      call.endedAt = Date.now();

      // Определяем собеседника из записи звонка
      peerUsername = peerUsername || (call.from === session.username ? call.to : call.from);

      if (call.answeredAt) {
        const duration = call.endedAt - call.answeredAt;
        console.log(`[${socket.id}] ⏱️ Длительность звонка: ${Math.round(duration / 1000)}с`);
      }

      activeCalls.delete(callId);
    } else {
      // Fallback: ищем активный звонок через перебор (если callId не передан)
      for (const [cid, call] of activeCalls.entries()) {
        if (call.from === session.username || call.to === session.username) {
          peerUsername = peerUsername || (call.from === session.username ? call.to : call.from);
          if (call.timeoutId) clearTimeout(call.timeoutId);
          activeCalls.delete(cid);
          break;
        }
      }
    }

    // [FIX] Отправить call_ended ТОЛЬКО собеседнику
    if (peerUsername) {
      const peerSocketId = onlineUsers.get(peerUsername);
      if (peerSocketId) {
        const peerSocket = io.sockets.sockets.get(peerSocketId);
        if (peerSocket) {
          peerSocket.emit('call_ended', { by: session.username });
        }
      }
    }
  });

  socket.on('cancel_call', async ({ to, callId }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;

    console.log(`[${socket.id}] 🔕 ${session.username} отменил звонок для ${to}`);

    // Найти звонок
    let call = null;
    if (callId && activeCalls.has(callId)) {
      call = activeCalls.get(callId);
      
      // Отменить таймаут
      if (call.timeoutId) {
        clearTimeout(call.timeoutId);
      }
      
      call.status = 'cancelled';
    }

    const targetSocketId = onlineUsers.get(to);
    
    if (targetSocketId) {
      // Пользователь онлайн - просто отменить
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('call_cancelled', { from: session.username });
        
        // Отправить push об отмене (чтобы убрать уведомление)
        const targetUser = await User.findOne({ username: to });
        if (targetUser && targetUser.fcmToken && firebaseService.isReady()) {
          await firebaseService.sendCallCancelledNotification(
            targetUser.fcmToken,
            session.username
          );
        }
      }
    } else {
      // Пользователь оффлайн - отправить missed call
      console.log(`[${socket.id}] 📧 Отправка missed call для ${to}`);
      await sendMissedCallNotification(to, session.username, call?.isVideo || false);
    }
    
    // Удалить звонок
    if (callId) {
      activeCalls.delete(callId);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // СООБЩЕНИЯ
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('send_message', async ({ to, message, timestamp }) => {
    const session = activeSessions.get(socket.id);
    if (!session) {
      return socket.emit('error', { message: 'Не авторизован' });
    }

    try {
      const messageId = generateMessageId();
      const newMessage = await Message.create({
        messageId,
        from: session.username,
        to,
        message,
        timestamp: timestamp || new Date(),
        read: false,
        delivered: false,
      });

      const targetSocketId = onlineUsers.get(to);
      
      if (targetSocketId) {
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
          targetSocket.emit('new_message', {
            from: session.username,
            message,
            timestamp: newMessage.timestamp,
            messageId
          });
          await Message.markAsDelivered(messageId);
        }
      } else {
        // Пользователь оффлайн - отправить Push
        const targetUser = await User.findOne({ username: to });
        if (targetUser && targetUser.fcmToken && firebaseService.isReady()) {
          await firebaseService.sendMessageNotification(
            targetUser.fcmToken,
            session.username,
            message,
            messageId
          );
        }
      }
      
      socket.emit('message_sent', {
        to,
        message,
        timestamp: newMessage.timestamp,
        messageId,
        delivered: !!targetSocketId
      });
      
      console.log(`[${socket.id}] 💬 ${session.username} → ${to}: "${message.substring(0, 30)}..."`);
    } catch (error) {
      console.error(`[${socket.id}] ❌ Ошибка отправки сообщения:`, error);
      socket.emit('error', { message: 'Ошибка отправки сообщения' });
    }
  });

  socket.on('get_messages', async ({ withUser, limit = 100 }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;
    
    try {
      const messages = await Message.getHistory(
        session.username,
        withUser,
        Math.min(limit, 100)
      );
      socket.emit('message_history', { withUser, messages });
    } catch (error) {
      console.error(`[${socket.id}] ❌ Ошибка получения истории:`, error);
      socket.emit('message_history', { withUser, messages: [] });
    }
  });

  socket.on('mark_read', async ({ from, messageId }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;
    
    await Message.markAsRead(from, session.username, messageId);
  });

  socket.on('get_unread_count', async () => {
    const session = activeSessions.get(socket.id);
    if (!session) return;
    
    const unread = await Message.getUnreadCount(session.username);
    socket.emit('unread_count', { unread });
  });

  socket.on('typing', ({ to, isTyping }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;
    
    const targetSocketId = onlineUsers.get(to);
    if (targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('typing', { from: session.username, isTyping });
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBRTC СИГНАЛИНГ
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('webrtc_offer', ({ to, offer }) => {
    const session = activeSessions.get(socket.id);
    const targetSocketId = onlineUsers.get(to);
    
    if (session && targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('webrtc_offer', { from: session.username, offer });
      }
    }
  });

  socket.on('webrtc_answer', ({ to, answer }) => {
    const session = activeSessions.get(socket.id);
    const targetSocketId = onlineUsers.get(to);
    
    if (session && targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('webrtc_answer', { from: session.username, answer });
      }
    }
  });

  socket.on('ice_candidate', ({ to, candidate }) => {
    const session = activeSessions.get(socket.id);
    const targetSocketId = onlineUsers.get(to);
    
    if (session && targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('ice_candidate', { from: session.username, candidate });
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // УПРАВЛЕНИЕ АККАУНТОМ
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Удаление своего аккаунта
   */
  socket.on('delete_my_account', async () => {
    const session = activeSessions.get(socket.id);
    if (!session) {
      return socket.emit('error', { message: 'Не авторизован' });
    }

    try {
      console.log(`[${socket.id}] 🗑️ ${session.username} удаляет свой аккаунт`);
      
      await User.deleteOne({ username: session.username });
      await Message.deleteMany({
        $or: [
          { from: session.username },
          { to: session.username }
        ]
      });
      
      socket.emit('account_deleted', { username: session.username });
      
      onlineUsers.delete(session.username);
      activeSessions.delete(socket.id);
      socket.disconnect();
      
      console.log(`[${socket.id}] ✅ Аккаунт ${session.username} удален`);
    } catch (error) {
      console.error(`[${socket.id}] ❌ Ошибка удаления аккаунта:`, error);
      socket.emit('error', { message: 'Не удалось удалить аккаунт' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ОТКЛЮЧЕНИЕ
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('disconnect', async () => {
    const session = activeSessions.get(socket.id);
    
    if (session) {
      // Отменить все активные звонки пользователя
      for (const [callId, call] of activeCalls.entries()) {
        if (call.from === session.username || call.to === session.username) {
          if (call.timeoutId) {
            clearTimeout(call.timeoutId);
          }
          
          // Если звонок не был отвечен - отправить missed call
          if (call.status === 'ringing' || call.status === 'calling' || call.status === 'push_sent') {
            const recipientUsername = call.from === session.username ? call.to : call.from;
            console.log(`[${socket.id}] 📞 Отправка missed call из-за отключения: ${call.from} → ${call.to}`);
            await sendMissedCallNotification(recipientUsername, session.username, call.isVideo);
          }
          
          activeCalls.delete(callId);
        }
      }
      
      await User.setOnlineStatus(session.username, false);
      onlineUsers.delete(session.username);
      activeSessions.delete(socket.id);
      broadcastUserOffline(session.username);
      await broadcastUsersList();
      
      console.log(`[${socket.id}] 👋 ${session.username} отключился`);
    }
  });
});

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

// [FIX v8.0.0] Используем crypto.randomBytes вместо Math.random() (Signal-style secure tokens)
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateMessageId() {
  return `msg_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function generateCallId() {
  return `call_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

async function disconnectPreviousSession(username) {
  const existingSocketId = onlineUsers.get(username);
  
  if (existingSocketId) {
    const existingSocket = io.sockets.sockets.get(existingSocketId);
    
    if (existingSocket) {
      existingSocket.emit('force_disconnect', {
        message: 'Вход выполнен с другого устройства'
      });
      existingSocket.disconnect();
    }
    
    onlineUsers.delete(username);
    activeSessions.delete(existingSocketId);
  }
}

async function broadcastUsersList() {
  try {
    for (const [socketId, session] of activeSessions.entries()) {
      const socket = io.sockets.sockets.get(socketId);
      
      if (socket) {
        const users = await User.getAllUsers(session.username, true);
        socket.emit('users_list', users);
      }
    }
  } catch (error) {
    console.error('[Server] ❌ Ошибка рассылки списка пользователей:', error);
  }
}

function broadcastUserOnline(username) {
  io.emit('user_online', { username });
}

function broadcastUserOffline(username) {
  io.emit('user_offline', { username });
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ОТПРАВКА УВЕДОМЛЕНИЯ О ПРОПУЩЕННОМ ЗВОНКЕ
 * ═══════════════════════════════════════════════════════════════════════════
 */
async function sendMissedCallNotification(toUsername, fromUsername, isVideo) {
  try {
    console.log('═══════════════════════════════════════');
    console.log('[MissedCall] 📧 ОТПРАВКА УВЕДОМЛЕНИЯ');
    console.log(`От: ${fromUsername}`);
    console.log(`Кому: ${toUsername}`);
    console.log(`Видео: ${isVideo}`);
    console.log('═══════════════════════════════════════');
    
    // Создать запись в сообщениях
    await Message.createMissedCallNotification(fromUsername, toUsername, isVideo);
    
    // Отправить push уведомление
    const targetUser = await User.findOne({ username: toUsername });
    if (targetUser && targetUser.fcmToken && firebaseService.isReady()) {
      await firebaseService.sendMissedCallNotification(
        targetUser.fcmToken,
        fromUsername,
        isVideo
      );
      console.log('[MissedCall] ✅ Push уведомление отправлено');
    } else {
      console.log('[MissedCall] ⚠️ Push не отправлен (нет токена или Firebase не готов)');
    }
    
    console.log('[MissedCall] ✅ Уведомление обработано');
  } catch (error) {
    console.error('[MissedCall] ❌ Ошибка:', error);
  }
}

// =============================================================================
// ЗАПУСК СЕРВЕРА
// =============================================================================

async function startServer() {
  try {
    await connectDatabase();
    await firebaseService.initialize();
    
    const PORT = process.env.PORT || 3000;
    
    server.listen(PORT, () => {
      console.log('╔═══════════════════════════════════╗');
      console.log('║  🚀 SecureCall Server v7.2.1 FULL║');
      console.log('╠═══════════════════════════════════╣');
      console.log(`║  Порт: ${PORT}                     ║`);
      console.log(`║  Firebase: ${firebaseService.isReady() ? '✅ Готов' : '❌ Не готов'}       ║`);
      console.log(`║  Call timeout: ${CALL_TIMEOUT_MS/1000}s           ║`);
      console.log(`║  Админ пароль: Rtex           ║`);
      console.log('╚═══════════════════════════════════╝');
    });
  } catch (error) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА ЗАПУСКА СЕРВЕРА:', error);
    process.exit(1);
  }
}

startServer();

// Graceful Shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM - завершение работы...');
  
  // Отменить все таймауты звонков
  for (const [callId, call] of activeCalls.entries()) {
    if (call.timeoutId) {
      clearTimeout(call.timeoutId);
    }
  }
  
  for (const username of onlineUsers.keys()) {
    await User.setOnlineStatus(username, false);
  }
  
  server.close(() => {
    console.log('✅ Сервер остановлен');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT - завершение работы...');
  
  // Отменить все таймауты звонков
  for (const [callId, call] of activeCalls.entries()) {
    if (call.timeoutId) {
      clearTimeout(call.timeoutId);
    }
  }
  
  for (const username of onlineUsers.keys()) {
    await User.setOnlineStatus(username, false);
  }
  
  server.close(() => {
    console.log('✅ Сервер остановлен');
    process.exit(0);
  });
});
