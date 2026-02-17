// config/database.js
const mongoose = require('mongoose');

/**
 * Подключение к MongoDB
 */
async function connectDatabase() {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/securecall';
    
    console.log('[MongoDB] Подключение к базе данных...');
    console.log(`[MongoDB] URI: ${mongoURI.replace(/\/\/.*:.*@/, '//***:***@')}`); // Скрываем пароль
    
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
    });
    
    console.log('[MongoDB] ✅ Подключено успешно');
    console.log(`[MongoDB] База данных: ${mongoose.connection.db.databaseName}`);
    
    // Обработка событий подключения
    mongoose.connection.on('error', (err) => {
      console.error('[MongoDB] ❌ Ошибка подключения:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.warn('[MongoDB] ⚠️ Отключено от базы данных');
    });
    
    mongoose.connection.on('reconnected', () => {
      console.log('[MongoDB] ✅ Переподключено к базе данных');
    });
    
    // Создание индексов
    await createIndexes();
    
    return mongoose.connection;
  } catch (error) {
    console.error('[MongoDB] ❌ Не удалось подключиться:', error.message);
    throw error;
  }
}

/**
 * Создание индексов для оптимизации запросов
 */
async function createIndexes() {
  try {
    console.log('[MongoDB] Создание индексов...');
    
    const User = require('../models/User');
    const Message = require('../models/Message');
    
    await User.createIndexes();
    await Message.createIndexes();
    
    console.log('[MongoDB] ✅ Индексы созданы');
  } catch (error) {
    console.error('[MongoDB] ❌ Ошибка создания индексов:', error.message);
  }
}

/**
 * Отключение от базы данных
 */
async function disconnectDatabase() {
  try {
    await mongoose.connection.close();
    console.log('[MongoDB] ✅ Отключено от базы данных');
  } catch (error) {
    console.error('[MongoDB] ❌ Ошибка отключения:', error.message);
  }
}

/**
 * Проверка подключения к базе данных
 */
function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Получение статистики базы данных
 */
async function getDatabaseStats() {
  try {
    const User = require('../models/User');
    const Message = require('../models/Message');
    
    const [totalUsers, onlineUsers, totalMessages, unreadMessages] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isOnline: true }),
      Message.countDocuments(),
      Message.countDocuments({ read: false }),
    ]);
    
    return {
      users: {
        total: totalUsers,
        online: onlineUsers,
        offline: totalUsers - onlineUsers,
      },
      messages: {
        total: totalMessages,
        unread: unreadMessages,
        read: totalMessages - unreadMessages,
      },
      database: {
        name: mongoose.connection.db.databaseName,
        connected: isDatabaseConnected(),
      },
    };
  } catch (error) {
    console.error('[MongoDB] Ошибка получения статистики:', error.message);
    return null;
  }
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  isDatabaseConnected,
  getDatabaseStats,
};
