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
const fs = require('fs');
const multer = require('multer');

// Настройка multer для загрузки APK
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const apkStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // Удаляем старый APK перед сохранением нового
    const files = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.apk'));
    files.forEach(f => fs.unlinkSync(path.join(uploadsDir, f)));
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  }
});

const apkUpload = multer({
  storage: apkStorage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.apk')) {
      return cb(new Error('Только .apk файлы разрешены'));
    }
    cb(null, true);
  }
});

// Метаданные текущего APK (хранятся в JSON файле)
const apkMetaPath = path.join(uploadsDir, 'apk-meta.json');

function getApkMeta() {
  try {
    if (fs.existsSync(apkMetaPath)) {
      return JSON.parse(fs.readFileSync(apkMetaPath, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveApkMeta(meta) {
  fs.writeFileSync(apkMetaPath, JSON.stringify(meta, null, 2));
}

function deleteApkMeta() {
  if (fs.existsSync(apkMetaPath)) {
    fs.unlinkSync(apkMetaPath);
  }
}

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
          
          <div class="download-section" id="downloadSection">
            <div class="download-title">🎉 Скачай приложение!</div>
            <div class="download-subtitle">Доступно для Android устройств</div>
            <div id="downloadContent" style="opacity: 0.7;">Загрузка...</div>
          </div>

          <script>
            fetch('/admin/apk/info')
              .then(r => r.json())
              .then(data => {
                const el = document.getElementById('downloadContent');
                if (data.apk) {
                  const sizeMB = (data.apk.size / 1024 / 1024).toFixed(1);
                  const ver = data.apk.version ? 'v' + data.apk.version : '';
                  el.innerHTML =
                    '<a href="/download/app.apk" class="download-button">📱 Скачать для Android</a>' +
                    '<div style="margin-top: 20px; font-size: 14px; opacity: 0.8;">' +
                      (ver ? ver + ' • ' : '') + sizeMB + ' МБ • Android 8.0+' +
                    '</div>';
                  el.style.opacity = '1';
                } else {
                  el.innerHTML = '<div style="font-size: 16px; opacity: 0.8;">Приложение пока не доступно для скачивания</div>';
                  el.style.opacity = '1';
                }
              })
              .catch(() => {
                document.getElementById('downloadContent').innerHTML =
                  '<div style="font-size: 16px; opacity: 0.8;">Не удалось загрузить информацию</div>';
              });
          </script>
          
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
            
            <!-- APK УПРАВЛЕНИЕ -->
            <div class="admin-card">
              <h2 style="margin-bottom: 20px;">📦 Управление APK</h2>

              <div id="apkMessage" class="hidden"></div>

              <div id="apkInfo" style="margin-bottom: 20px; padding: 20px; background: #f5f5f5; border-radius: 12px;">
                Загрузка информации...
              </div>

              <div style="display: flex; gap: 15px; flex-wrap: wrap; align-items: flex-end;">
                <div style="flex: 1; min-width: 200px;">
                  <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #333;">APK файл:</label>
                  <input type="file" id="apkFile" accept=".apk" style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 14px;">
                </div>
                <div style="min-width: 150px;">
                  <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #333;">Версия:</label>
                  <input type="text" id="apkVersion" placeholder="Напр. 7.2.1" style="width: 100%; padding: 10px 15px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 14px;">
                </div>
                <button onclick="uploadApk()" class="btn btn-primary" style="padding: 10px 25px; width: auto; white-space: nowrap;">
                  📤 Загрузить APK
                </button>
              </div>

              <div id="uploadProgress" class="hidden" style="margin-top: 15px;">
                <div style="background: #e0e0e0; border-radius: 10px; overflow: hidden; height: 8px;">
                  <div id="progressBar" style="width: 0%; height: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); transition: width 0.3s;"></div>
                </div>
                <div id="progressText" style="text-align: center; margin-top: 5px; font-size: 13px; color: #666;">0%</div>
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
                loadApkInfo();
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
          
          // ==================== APK ====================

          async function loadApkInfo() {
            try {
              const response = await fetch('/admin/apk/info');
              const data = await response.json();
              const div = document.getElementById('apkInfo');

              if (data.apk) {
                const sizeMB = (data.apk.size / 1024 / 1024).toFixed(1);
                const date = new Date(data.apk.uploadedAt).toLocaleString('ru-RU');
                div.innerHTML = \`
                  <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                    <div>
                      <div style="font-weight: 700; font-size: 16px; color: #333;">📱 \${data.apk.originalName}</div>
                      <div style="font-size: 13px; color: #666; margin-top: 5px;">
                        Версия: <strong>\${data.apk.version || '—'}</strong> &nbsp;|&nbsp; Размер: <strong>\${sizeMB} МБ</strong> &nbsp;|&nbsp; Загружен: \${date}
                      </div>
                    </div>
                    <button onclick="deleteApk()" class="btn-small btn-delete" style="padding: 8px 16px;">🗑️ Удалить APK</button>
                  </div>
                \`;
              } else {
                div.innerHTML = '<div style="text-align: center; color: #999;">APK файл не загружен</div>';
              }
            } catch (error) {
              console.error('Ошибка загрузки APK info:', error);
            }
          }

          async function uploadApk() {
            const fileInput = document.getElementById('apkFile');
            const versionInput = document.getElementById('apkVersion');

            if (!fileInput.files.length) {
              showApkMessage('Выберите APK файл', 'error');
              return;
            }

            const file = fileInput.files[0];
            if (!file.name.toLowerCase().endsWith('.apk')) {
              showApkMessage('Только .apk файлы разрешены', 'error');
              return;
            }

            const formData = new FormData();
            formData.append('apk', file);
            formData.append('version', versionInput.value);

            const progressDiv = document.getElementById('uploadProgress');
            const progressBar = document.getElementById('progressBar');
            const progressText = document.getElementById('progressText');
            progressDiv.classList.remove('hidden');
            progressBar.style.width = '0%';
            progressText.textContent = '0%';

            try {
              const xhr = new XMLHttpRequest();
              xhr.open('POST', '/admin/apk/upload');
              xhr.setRequestHeader('X-Admin-Session', sessionId);

              xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                  const pct = Math.round((e.loaded / e.total) * 100);
                  progressBar.style.width = pct + '%';
                  progressText.textContent = pct + '%';
                }
              };

              xhr.onload = () => {
                progressDiv.classList.add('hidden');
                try {
                  const data = JSON.parse(xhr.responseText);
                  if (data.success) {
                    showApkMessage('APK успешно загружен!', 'success');
                    fileInput.value = '';
                    versionInput.value = '';
                    loadApkInfo();
                  } else {
                    showApkMessage(data.message || 'Ошибка загрузки', 'error');
                  }
                } catch (e) {
                  showApkMessage('Ошибка обработки ответа сервера', 'error');
                }
              };

              xhr.onerror = () => {
                progressDiv.classList.add('hidden');
                showApkMessage('Ошибка подключения к серверу', 'error');
              };

              xhr.send(formData);
            } catch (error) {
              progressDiv.classList.add('hidden');
              showApkMessage('Ошибка загрузки', 'error');
            }
          }

          async function deleteApk() {
            if (!confirm('Удалить текущий APK файл?')) return;

            try {
              const response = await fetch('/admin/apk/delete', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Admin-Session': sessionId
                }
              });

              const data = await response.json();
              if (data.success) {
                showApkMessage('APK удален', 'success');
                loadApkInfo();
              } else {
                showApkMessage(data.message || 'Ошибка удаления', 'error');
              }
            } catch (error) {
              showApkMessage('Ошибка подключения к серверу', 'error');
            }
          }

          function showApkMessage(text, type) {
            const div = document.getElementById('apkMessage');
            div.textContent = text;
            div.className = type === 'success' ? 'success-message' : 'error-message';
            setTimeout(() => { div.classList.add('hidden'); }, 3000);
          }

          // ==================== /APK ====================

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
// APK UPLOAD / DOWNLOAD / DELETE
// =============================================================================

// Загрузка APK (только для авторизованного админа)
app.post('/admin/apk/upload', (req, res) => {
  const sessionId = req.headers['x-admin-session'];

  if (!isValidAdminSession(sessionId)) {
    return res.status(401).json({ success: false, message: 'Не авторизован' });
  }

  apkUpload.single('apk')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.json({ success: false, message: 'Файл слишком большой (макс. 200 МБ)' });
        }
        return res.json({ success: false, message: `Ошибка загрузки: ${err.message}` });
      }
      return res.json({ success: false, message: err.message });
    }

    if (!req.file) {
      return res.json({ success: false, message: 'Файл не выбран' });
    }

    const version = req.body.version || '';
    const meta = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      version: version,
      uploadedAt: new Date().toISOString(),
    };
    saveApkMeta(meta);

    console.log(`[Admin] 📦 APK загружен: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)} МБ)`);

    res.json({ success: true, meta });
  });
});

// Получить информацию о текущем APK
app.get('/admin/apk/info', (req, res) => {
  const meta = getApkMeta();
  if (!meta) {
    return res.json({ success: true, apk: null });
  }
  res.json({ success: true, apk: meta });
});

// Удалить текущий APK (только админ)
app.post('/admin/apk/delete', (req, res) => {
  const sessionId = req.headers['x-admin-session'];

  if (!isValidAdminSession(sessionId)) {
    return res.status(401).json({ success: false, message: 'Не авторизован' });
  }

  const meta = getApkMeta();
  if (!meta) {
    return res.json({ success: false, message: 'APK не найден' });
  }

  const filePath = path.join(uploadsDir, meta.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  deleteApkMeta();

  console.log('[Admin] 🗑️ APK удален');

  res.json({ success: true });
});

// Скачивание APK (публичный доступ)
app.get('/download/app.apk', (req, res) => {
  const meta = getApkMeta();
  if (!meta) {
    return res.status(404).send('APK файл не найден');
  }

  const filePath = path.join(uploadsDir, meta.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('APK файл не найден');
  }

  res.download(filePath, meta.originalName);
});

// =============================================================================
// SOCKET.IO EVENTS (extracted to socketHandlers.js for maintainability)
// =============================================================================

const { initSocketHandlers } = require('./socketHandlers');
initSocketHandlers(io, {
  activeSessions,
  onlineUsers,
  activeCalls,
  CALL_TIMEOUT_MS,
  User,
  Message,
  firebaseService,
});

// generateToken for admin session creation (same algorithm as in socketHandlers.js)
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/*
 * ═══════════════════════════════════════════════════════════
 * NOTE: All socket event handlers (register, login, auth_token,
 * call, accept_call, reject_call, end_call, cancel_call,
 * send_message, get_messages, webrtc_offer/answer/ice,
 * delete_my_account, disconnect) and their helper functions
 * (generateMessageId, generateCallId, disconnectPreviousSession,
 * broadcastUsersList, checkPendingCallsForUser, broadcastUserOnline,
 * broadcastUserOffline, sendMissedCallNotification) are now in
 * socketHandlers.js
 * ═══════════════════════════════════════════════════════════
 */

// --- All original socket handlers have been moved to socketHandlers.js ---


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
