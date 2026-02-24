// socketHandlers.js - Socket.IO event handlers (extracted from server.js)
// Version: v8.0.0

const crypto = require('crypto');

/**
 * Initialize all Socket.IO event handlers
 * @param {Object} io - Socket.IO server instance
 * @param {Object} deps - Dependencies { activeSessions, onlineUsers, activeCalls, CALL_TIMEOUT_MS, User, Message, firebaseService }
 */
function initSocketHandlers(io, deps) {
  const { activeSessions, onlineUsers, activeCalls, CALL_TIMEOUT_MS, User, Message, firebaseService } = deps;

  // ═══════════════════════════════════════════════════════════════════════════
  // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
  // ═══════════════════════════════════════════════════════════════════════════

  // [FIX v8.0.0] crypto.randomBytes вместо Math.random() (Signal-style secure tokens)
  function generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  function generateMessageId() {
    return `msg_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  function generateCallId() {
    return `call_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  async function disconnectPreviousSession(username, currentSocketId) {
    const existingSocketId = onlineUsers.get(username);

    if (existingSocketId && existingSocketId !== currentSocketId) {
      const existingSocket = io.sockets.sockets.get(existingSocketId);

      if (existingSocket) {
        console.log(`[Server] Отключаем старую сессию ${existingSocketId} для ${username} (новая: ${currentSocketId})`);
        existingSocket.emit('force_disconnect', {
          message: 'Вход выполнен с другого устройства'
        });
        // Delay disconnect to allow force_disconnect to be delivered
        setTimeout(() => {
          try { existingSocket.disconnect(); } catch (e) { /* ignore */ }
        }, 500);
      }

      activeSessions.delete(existingSocketId);
    }
    // Always clean up onlineUsers — it will be re-set by the caller
    if (existingSocketId) {
      onlineUsers.delete(username);
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

  /**
   * [FIX] Check for pending incoming calls when a user re-authenticates.
   * This handles the case when the app was killed, FCM push was sent,
   * user opens the app from notification, auto-logs in, and needs to
   * receive the incoming_call event again through the socket.
   */
  function checkPendingCallsForUser(socket, username) {
    for (const [callId, call] of activeCalls.entries()) {
      if (call.to === username && (call.status === 'ringing' || call.status === 'push_sent' || call.status === 'calling')) {
        console.log(`[${socket.id}] 📞 Re-sending pending incoming_call to ${username} (callId: ${callId})`);
        socket.emit('incoming_call', {
          callId,
          from: call.from,
          isVideo: call.isVideo,
        });
      }
    }
  }

  function broadcastUserOnline(username) {
    io.emit('user_online', { username });
  }

  function broadcastUserOffline(username) {
    io.emit('user_offline', { username });
  }

  /**
   * ОТПРАВКА УВЕДОМЛЕНИЯ О ПРОПУЩЕННОМ ЗВОНКЕ
   */
  async function sendMissedCallNotification(toUsername, fromUsername, isVideo) {
    try {
      console.log('═══════════════════════════════════════');
      console.log('[MissedCall] ОТПРАВКА УВЕДОМЛЕНИЯ');
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

  // ═══════════════════════════════════════════════════════════════════════════
  // SOCKET.IO CONNECTION HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  io.on('connection', (socket) => {
    console.log(`[${socket.id}] 🔌 Новое подключение`);

    // ═══════════════════════════════════════════════════════════════════════
    // РЕГИСТРАЦИЯ И АВТОРИЗАЦИЯ
    // ═══════════════════════════════════════════════════════════════════════

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

        await disconnectPreviousSession(username, socket.id);
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

        // [FIX] Re-send pending calls for users who reconnected (e.g. app was killed)
        checkPendingCallsForUser(socket, user.username);

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

        await disconnectPreviousSession(username, socket.id);
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

        // [FIX] Re-send pending calls for users who reconnected (e.g. app was killed)
        checkPendingCallsForUser(socket, user.username);

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

    // ═══════════════════════════════════════════════════════════════════════
    // ЗВОНКИ - УЛУЧШЕННАЯ ЛОГИКА С АВТОМАТИЧЕСКИМ MISSED CALL
    // ═══════════════════════════════════════════════════════════════════════

    socket.on('call', async ({ to, isVideo }) => {
      const session = activeSessions.get(socket.id);
      if (!session) {
        return socket.emit('error', { message: 'Не авторизован' });
      }

      const callId = generateCallId();

      console.log('═══════════════════════════════════════');
      console.log(`[${socket.id}] НОВЫЙ ЗВОНОК`);
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
        // ПОЛЬЗОВАТЕЛЬ ОНЛАЙН
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
              console.log(`[CallTimeout] ТАЙМАУТ ЗВОНКА`);
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
        // ПОЛЬЗОВАТЕЛЬ ОФФЛАЙН - ОТПРАВИТЬ PUSH
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
            console.log(`[${socket.id}] Отправка Wake-Up Push для ${to}...`);

            // Отправляем push с максимальным приоритетом
            const pushResult = await firebaseService.sendIncomingCallPush(
              targetUser.fcmToken,
              session.username,
              isVideo,
              callId
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
                  console.log(`[CallTimeout] ОФФЛАЙН ЗВОНОК НЕ ОТВЕЧЕН - ${callId}`);

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

      console.log(`[${socket.id}] Активных звонков: ${activeCalls.size}`);
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

        console.log(`[${socket.id}] Время ответа: ${call.answeredAt - call.timestamp}ms`);
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
    socket.on('end_call', ({ callId, to }) => {
      const session = activeSessions.get(socket.id);
      if (!session) return;

      console.log(`[${socket.id}] ${session.username} завершил звонок`);

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
          console.log(`[${socket.id}] Длительность звонка: ${Math.round(duration / 1000)}с`);
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

      console.log(`[${socket.id}] ${session.username} отменил звонок для ${to}`);

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
        console.log(`[${socket.id}] Отправка missed call для ${to}`);
        await sendMissedCallNotification(to, session.username, call?.isVideo || false);
      }

      // Удалить звонок
      if (callId) {
        activeCalls.delete(callId);
      }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // СООБЩЕНИЯ
    // ═══════════════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════════════
    // WEBRTC СИГНАЛИНГ
    // ═══════════════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════════════
    // УПРАВЛЕНИЕ АККАУНТОМ
    // ═══════════════════════════════════════════════════════════════════════

    socket.on('delete_my_account', async () => {
      const session = activeSessions.get(socket.id);
      if (!session) {
        return socket.emit('error', { message: 'Не авторизован' });
      }

      try {
        console.log(`[${socket.id}] ${session.username} удаляет свой аккаунт`);

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

    // ═══════════════════════════════════════════════════════════════════════
    // ОТКЛЮЧЕНИЕ
    // ═══════════════════════════════════════════════════════════════════════

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
              console.log(`[${socket.id}] Отправка missed call из-за отключения: ${call.from} → ${call.to}`);
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

  // Return helper functions that server.js needs (e.g. generateToken for admin)
  return { generateToken };
}

module.exports = { initSocketHandlers };
