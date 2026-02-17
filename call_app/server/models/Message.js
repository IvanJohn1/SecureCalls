// models/Message.js - ИСПРАВЛЕННАЯ ВЕРСИЯ v7.2
const mongoose = require('mongoose');

/**
 * ═══════════════════════════════════════════════════════════
 * Message Model v7.2 - ИСПРАВЛЕНО ДЛЯ СТАБИЛЬНОСТИ
 * ═══════════════════════════════════════════════════════════
 */

const MessageSchema = new mongoose.Schema({
  messageId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  from: {
    type: String,
    required: true,
    index: true,
    trim: true,
  },
  to: {
    type: String,
    required: true,
    index: true,
    trim: true,
  },
  message: {
    type: String,
    required: true,
    maxlength: 5000,
    default: '',
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
    index: true,
  },
  read: {
    type: Boolean,
    default: false,
    index: true,
  },
  readAt: {
    type: Date,
    default: null,
  },
  delivered: {
    type: Boolean,
    default: false,
  },
  deliveredAt: {
    type: Date,
    default: null,
  },
  type: {
    type: String,
    enum: ['text', 'system', 'call_notification', 'missed_call'],
    default: 'text',
  },
}, {
  timestamps: true,
});

// ═══════════════════════════════════════════════════════════
// СОСТАВНЫЕ ИНДЕКСЫ ДЛЯ БЫСТРОГО ПОИСКА
// ═══════════════════════════════════════════════════════════

MessageSchema.index({ from: 1, to: 1, timestamp: -1 });
MessageSchema.index({ to: 1, read: 1, timestamp: -1 });
MessageSchema.index({ messageId: 1 }, { unique: true });
MessageSchema.index({ type: 1, timestamp: -1 });

// ═══════════════════════════════════════════════════════════
// СТАТИЧЕСКИЕ МЕТОДЫ
// ═══════════════════════════════════════════════════════════

/**
 * Получение истории сообщений между двумя пользователями
 */
MessageSchema.statics.getHistory = async function(user1, user2, limit = 100) {
  try {
    // Валидация входных данных
    if (!user1 || !user2) {
      console.error('[Message] getHistory: отсутствуют user1 или user2');
      return [];
    }

    const messages = await this.find({
      $or: [
        { from: user1, to: user2 },
        { from: user2, to: user1 }
      ]
    })
      .sort({ timestamp: -1 })
      .limit(Math.min(limit, 500)) // Макс 500 сообщений
      .lean()
      .exec();

    return messages || [];
  } catch (error) {
    console.error('[Message] getHistory ошибка:', error);
    return [];
  }
};

/**
 * Получение непрочитанных сообщений для пользователя
 */
MessageSchema.statics.getUnreadMessages = async function(username) {
  try {
    if (!username) {
      console.error('[Message] getUnreadMessages: отсутствует username');
      return [];
    }

    const messages = await this.find({
      to: username,
      read: false,
    })
      .sort({ timestamp: -1 })
      .limit(100) // Макс 100 непрочитанных
      .lean()
      .exec();

    return messages || [];
  } catch (error) {
    console.error('[Message] getUnreadMessages ошибка:', error);
    return [];
  }
};

/**
 * Подсчет непрочитанных сообщений по отправителям
 */
MessageSchema.statics.getUnreadCount = async function(username) {
  try {
    if (!username) {
      console.error('[Message] getUnreadCount: отсутствует username');
      return {};
    }

    const messages = await this.aggregate([
      {
        $match: {
          to: username,
          read: false,
        }
      },
      {
        $group: {
          _id: '$from',
          count: { $sum: 1 }
        }
      }
    ]).exec();
    
    // Преобразовать в объект { username: count }
    const result = {};
    if (messages && Array.isArray(messages)) {
      messages.forEach(item => {
        if (item && item._id) {
          result[item._id] = item.count || 0;
        }
      });
    }
    
    return result;
  } catch (error) {
    console.error('[Message] getUnreadCount ошибка:', error);
    return {};
  }
};

/**
 * Отметка сообщений как прочитанных
 */
MessageSchema.statics.markAsRead = async function(from, to, messageId = null) {
  try {
    if (!from || !to) {
      console.error('[Message] markAsRead: отсутствуют from или to');
      return null;
    }

    const query = { from, to, read: false };
    
    if (messageId) {
      query.messageId = messageId;
    }
    
    const result = await this.updateMany(
      query,
      {
        $set: {
          read: true,
          readAt: new Date(),
        }
      }
    ).exec();

    console.log(`[Message] markAsRead: ${result.modifiedCount} сообщений отмечено как прочитанные`);
    return result;
  } catch (error) {
    console.error('[Message] markAsRead ошибка:', error);
    return null;
  }
};

/**
 * Отметка сообщения как доставленного
 */
MessageSchema.statics.markAsDelivered = async function(messageId) {
  try {
    if (!messageId) {
      console.error('[Message] markAsDelivered: отсутствует messageId');
      return null;
    }

    const result = await this.findOneAndUpdate(
      { messageId },
      {
        $set: {
          delivered: true,
          deliveredAt: new Date(),
        }
      },
      { new: true }
    ).exec();

    return result;
  } catch (error) {
    console.error('[Message] markAsDelivered ошибка:', error);
    return null;
  }
};

/**
 * Создание системного сообщения
 */
MessageSchema.statics.createSystemMessage = async function(from, to, message, type = 'system') {
  try {
    if (!from || !to || !message) {
      console.error('[Message] createSystemMessage: отсутствуют обязательные параметры');
      return null;
    }

    const messageId = generateMessageId();
    
    const newMessage = await this.create({
      messageId,
      from,
      to,
      message,
      type,
      timestamp: new Date(),
      read: false,
      delivered: false,
    });

    console.log(`[Message] Системное сообщение создано: ${messageId}`);
    return newMessage;
  } catch (error) {
    console.error('[Message] createSystemMessage ошибка:', error);
    return null;
  }
};

/**
 * Создание уведомления о пропущенном звонке
 */
MessageSchema.statics.createMissedCallNotification = async function(from, to, isVideo = false) {
  try {
    if (!from || !to) {
      console.error('[Message] createMissedCallNotification: отсутствуют from или to');
      return null;
    }

    const messageId = generateMessageId();
    const callType = isVideo ? 'видеозвонок' : 'звонок';
    const message = `Пропущенный ${callType} от ${from}`;
    
    const newMessage = await this.create({
      messageId,
      from,
      to,
      message,
      type: 'missed_call',
      timestamp: new Date(),
      read: false,
      delivered: false,
    });

    console.log(`[Message] Уведомление о пропущенном звонке создано: ${from} → ${to}`);
    return newMessage;
  } catch (error) {
    console.error('[Message] createMissedCallNotification ошибка:', error);
    return null;
  }
};

/**
 * Удаление старых сообщений (для очистки БД)
 */
MessageSchema.statics.deleteOldMessages = async function(daysOld = 90) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.deleteMany({
      timestamp: { $lt: cutoffDate }
    }).exec();

    console.log(`[Message] Удалено старых сообщений: ${result.deletedCount}`);
    return result.deletedCount;
  } catch (error) {
    console.error('[Message] deleteOldMessages ошибка:', error);
    return 0;
  }
};

/**
 * Получение последнего сообщения с каждым пользователем
 */
MessageSchema.statics.getLastMessagesPerUser = async function(username) {
  try {
    if (!username) {
      console.error('[Message] getLastMessagesPerUser: отсутствует username');
      return [];
    }

    // Получаем все уникальные контакты
    const contacts = await this.aggregate([
      {
        $match: {
          $or: [{ from: username }, { to: username }]
        }
      },
      {
        $project: {
          contact: {
            $cond: {
              if: { $eq: ['$from', username] },
              then: '$to',
              else: '$from'
            }
          },
          timestamp: 1,
          message: 1,
          from: 1,
          to: 1,
          read: 1,
          type: 1,
        }
      },
      {
        $sort: { timestamp: -1 }
      },
      {
        $group: {
          _id: '$contact',
          lastMessage: { $first: '$$ROOT' }
        }
      },
      {
        $sort: { 'lastMessage.timestamp': -1 }
      }
    ]).exec();

    return contacts || [];
  } catch (error) {
    console.error('[Message] getLastMessagesPerUser ошибка:', error);
    return [];
  }
};

// ═══════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════

/**
 * Генерация уникального ID сообщения
 */
function generateMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// ═══════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════

/**
 * Перед сохранением - валидация и очистка данных
 */
MessageSchema.pre('save', function(next) {
  try {
    // Очистка пробелов
    if (this.from) this.from = this.from.trim();
    if (this.to) this.to = this.to.trim();
    if (this.message) this.message = this.message.trim();

    // Проверка обязательных полей
    if (!this.from || !this.to || !this.message) {
      return next(new Error('Отсутствуют обязательные поля'));
    }

    // Генерация messageId если нет
    if (!this.messageId) {
      this.messageId = generateMessageId();
    }

    next();
  } catch (error) {
    console.error('[Message] pre save ошибка:', error);
    next(error);
  }
});

/**
 * После сохранения - логирование
 */
MessageSchema.post('save', function(doc, next) {
  console.log(`[Message] Сообщение сохранено: ${doc.messageId} | ${doc.from} → ${doc.to}`);
  next();
});

/**
 * Обработка ошибок
 */
MessageSchema.post('save', function(error, doc, next) {
  if (error.name === 'MongoError' && error.code === 11000) {
    console.error('[Message] Дубликат messageId:', error);
    next(new Error('Сообщение с таким ID уже существует'));
  } else {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ЭКСПОРТ
// ═══════════════════════════════════════════════════════════

const Message = mongoose.model('Message', MessageSchema);

module.exports = Message;
