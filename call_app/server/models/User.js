// models/User.js - ИСПРАВЛЕННАЯ ВЕРСИЯ v7.0
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

/**
 * ═══════════════════════════════════════════════════════════
 * User Model v7.0 - С ПОДДЕРЖКОЙ АДМИНА И БАНА
 * ═══════════════════════════════════════════════════════════
 */

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 20,
    index: true,
  },
  password: {
    type: String,
    required: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  fcmToken: {
    type: String,
    default: null,
  },
  platform: {
    type: String,
    enum: ['android', 'ios', null],
    default: null,
  },
  
  // ═══════════════════════════════════════
  // НОВЫЕ ПОЛЯ v7.0
  // ═══════════════════════════════════════
  isAdmin: {
    type: Boolean,
    default: false,
    index: true,
  },
  isBanned: {
    type: Boolean,
    default: false,
    index: true,
  },
  banReason: {
    type: String,
    default: null,
  },
  bannedAt: {
    type: Date,
    default: null,
  },
  bannedBy: {
    type: String,
    default: null,
  },
  
  isOnline: {
    type: Boolean,
    default: false,
    index: true,
  },
  lastSeen: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Индексы для быстрого поиска
UserSchema.index({ username: 1 });
UserSchema.index({ token: 1 });
UserSchema.index({ isOnline: 1 });
UserSchema.index({ isAdmin: 1 });
UserSchema.index({ isBanned: 1 });

// Middleware для хеширования пароля перед сохранением
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Метод для проверки пароля
UserSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

// Метод для генерации токена
UserSchema.methods.generateToken = function() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

// Метод для получения публичных данных (без пароля)
UserSchema.methods.toPublic = function() {
  return {
    username: this.username,
    isOnline: this.isOnline,
    isAdmin: this.isAdmin,
    isBanned: this.isBanned,
    banReason: this.banReason,
    lastSeen: this.lastSeen,
    createdAt: this.createdAt,
  };
};

// Статический метод для поиска пользователя по username или token
UserSchema.statics.findByCredentials = async function(username, password) {
  const user = await this.findOne({ username });
  
  if (!user) {
    throw new Error('Пользователь не найден');
  }
  
  const isMatch = await user.comparePassword(password);
  
  if (!isMatch) {
    throw new Error('Неверный пароль');
  }
  
  return user;
};

// Статический метод для поиска по токену
UserSchema.statics.findByToken = async function(username, token) {
  const user = await this.findOne({ username, token });
  
  if (!user) {
    throw new Error('Недействительный токен');
  }
  
  return user;
};

// Статический метод для получения всех пользователей (онлайн и оффлайн)
UserSchema.statics.getAllUsers = async function(excludeUsername = null, includeOffline = true) {
  const query = includeOffline ? {} : { isOnline: true };
  
  if (excludeUsername) {
    query.username = { $ne: excludeUsername };
  }
  
  return await this.find(query)
    .select('username isOnline isAdmin isBanned banReason lastSeen createdAt')
    .sort({ isOnline: -1, lastSeen: -1 })
    .lean();
};

// Статический метод для обновления статуса онлайн
UserSchema.statics.setOnlineStatus = async function(username, isOnline) {
  return await this.findOneAndUpdate(
    { username },
    { 
      isOnline,
      lastSeen: new Date(),
      updatedAt: new Date(),
    },
    { new: true }
  );
};

// Статический метод для обновления FCM токена
UserSchema.statics.updateFCMToken = async function(username, fcmToken, platform) {
  return await this.findOneAndUpdate(
    { username },
    { 
      fcmToken,
      platform,
      updatedAt: new Date(),
    },
    { new: true }
  );
};

// ═══════════════════════════════════════════════════════════
// НОВЫЕ МЕТОДЫ v7.0 - АДМИН ФУНКЦИИ
// ═══════════════════════════════════════════════════════════

/**
 * Забанить пользователя
 */
UserSchema.statics.banUser = async function(username, reason, bannedBy) {
  return await this.findOneAndUpdate(
    { username },
    {
      isBanned: true,
      banReason: reason || 'Нарушение правил',
      bannedAt: new Date(),
      bannedBy: bannedBy,
      updatedAt: new Date(),
    },
    { new: true }
  );
};

/**
 * Разбанить пользователя
 */
UserSchema.statics.unbanUser = async function(username) {
  return await this.findOneAndUpdate(
    { username },
    {
      isBanned: false,
      banReason: null,
      bannedAt: null,
      bannedBy: null,
      updatedAt: new Date(),
    },
    { new: true }
  );
};

/**
 * Проверить, является ли пользователь админом
 */
UserSchema.statics.isAdmin = async function(username) {
  const user = await this.findOne({ username }).select('isAdmin').lean();
  return user ? user.isAdmin : false;
};

const User = mongoose.model('User', UserSchema);

module.exports = User;
