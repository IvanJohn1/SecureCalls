import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Alert,
} from 'react-native';
import SocketService from '../services/SocketService';

/**
 * ═══════════════════════════════════════════════════════════
 * ChatScreen v9.0 FIX - ИСПРАВЛЕН СКРОЛЛ + ПОРЯДОК
 * ═══════════════════════════════════════════════════════════
 *
 * ИСПРАВЛЕНО:
 * 1. ✅ Сообщения правильно отображаются снизу (новые внизу)
 * 2. ✅ Автопрокрутка к последнему сообщению при загрузке
 * 3. ✅ Автопрокрутка при новом сообщении
 * 4. ✅ scrollToEnd не зависит от замыкания messages
 * 5. ✅ Защита от race conditions
 */

console.log('╔════════════════════════════════════════╗');
console.log('║  ChatScreen v9.0 FIX                  ║');
console.log('╚════════════════════════════════════════╝');

export default function ChatScreen({route, navigation}) {
  const {username, targetUser} = route.params;
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const flatListRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);
  useEffect(() => {
    console.log('[ChatScreen v9.0] 💬 Открыт чат с:', targetUser);

    isMountedRef.current = true;

    // Проверка подключения
    if (!SocketService.isConnected()) {
      console.error('[ChatScreen] ✗ Нет подключения к серверу');
      Alert.alert('Ошибка', 'Нет подключения к серверу.', [
        {text: 'OK', onPress: () => navigation.goBack()},
      ]);
      return;
    }

    // Запросить историю сообщений
    SocketService.getMessageHistory(targetUser);

    // Подписаться на события
    setupSocketListeners();

    // Отслеживать статус подключения
    const checkConnection = setInterval(() => {
      const connected = SocketService.isConnected();
      if (isMountedRef.current) {
        setIsConnected(connected);
      }
    }, 3000);

    return () => {
      isMountedRef.current = false;
      cleanupSocketListeners();
      clearInterval(checkConnection);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [targetUser]);

  const setupSocketListeners = () => {
    SocketService.on('message_history', handleMessageHistory);
    SocketService.on('new_message', handleNewMessage);
    SocketService.on('typing', handleTyping);
    SocketService.on('message_sent', handleMessageSent);
    SocketService.on('disconnect', handleDisconnect);
    SocketService.on('connect', handleReconnect);
  };

  const cleanupSocketListeners = () => {
    SocketService.off('message_history', handleMessageHistory);
    SocketService.off('new_message', handleNewMessage);
    SocketService.off('typing', handleTyping);
    SocketService.off('message_sent', handleMessageSent);
    SocketService.off('disconnect', handleDisconnect);
    SocketService.off('connect', handleReconnect);
  };

  const handleDisconnect = () => {
    if (isMountedRef.current) {
      setIsConnected(false);
    }
  };

  const handleReconnect = () => {
    if (isMountedRef.current) {
      setIsConnected(true);
      SocketService.getMessageHistory(targetUser);
    }
  };

  /**
   * FIX: Обработка истории сообщений
   * Используем setTimeout с увеличенной задержкой для гарантированного скролла
   */
  const handleMessageHistory = data => {
    if (!isMountedRef.current) return;

    if (data.withUser === targetUser) {
      console.log(
        '[ChatScreen] 📜 Получена история:',
        data.messages.length,
        'сообщений',
      );

      const formattedMessages = data.messages.map(msg => ({
        id:
          msg.id ||
          msg.messageId ||
          msg.timestamp?.toString() ||
          Math.random().toString(),
        from: msg.from,
        to: msg.to,
        message: msg.message,
        timestamp: msg.timestamp,
        isMine: msg.from === username,
      }));

      // Server returns messages sorted by timestamp DESC (newest first).
      // inverted FlatList renders index 0 at the bottom, so newest-first is correct as-is.
      setMessages(formattedMessages);
      setIsLoadingHistory(false);
    }
  };

  /**
   * Обработка нового входящего сообщения
   */
  const handleNewMessage = data => {
    if (!isMountedRef.current) return;

    if (data.from === targetUser) {
      console.log('[ChatScreen] 💬 Новое сообщение от:', data.from);

      const newMessage = {
        id: data.messageId || Date.now().toString(),
        from: data.from,
        to: username,
        message: data.message,
        timestamp: data.timestamp || Date.now(),
        isMine: false,
      };

      // Prepend to array — inverted FlatList shows index 0 at the bottom
      setMessages(prev => [newMessage, ...prev]);

      // Отметить как прочитанное
      if (data.messageId) {
        SocketService.markAsRead(targetUser, data.messageId);
      }
    }
  };

  const handleTyping = data => {
    if (!isMountedRef.current) return;
    if (data.from === targetUser) {
      setIsTyping(data.isTyping);
    }
  };

  /**
   * Обработка подтверждения отправки
   */
  const handleMessageSent = data => {
    if (!isMountedRef.current) return;

    console.log('[ChatScreen] ✅ Сообщение отправлено:', data);

    const sentMessage = {
      id: data.messageId || Date.now().toString(),
      from: username,
      to: targetUser,
      message: data.message,
      timestamp: data.timestamp || Date.now(),
      isMine: true,
    };

    // Prepend to array — inverted FlatList shows index 0 at the bottom
    setMessages(prev => [sentMessage, ...prev]);
  };

  // scrollToBottom no longer needed — inverted FlatList auto-scrolls to newest

  /**
   * Отправка сообщения
   */
  const sendMessage = () => {
    if (!inputText.trim()) return;

    if (!SocketService.isConnected()) {
      Alert.alert('Ошибка', 'Нет подключения к серверу');
      return;
    }

    console.log('[ChatScreen] 📤 Отправка:', inputText);

    const sent = SocketService.sendMessage(targetUser, inputText.trim());
    if (!sent) {
      Alert.alert('Ошибка', 'Не удалось отправить сообщение.');
      return;
    }

    setInputText('');
    SocketService.sendTyping(targetUser, false);
  };

  const handleTextChange = text => {
    setInputText(text);

    if (SocketService.isConnected()) {
      SocketService.sendTyping(targetUser, true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      if (SocketService.isConnected()) {
        SocketService.sendTyping(targetUser, false);
      }
    }, 2000);
  };

  /**
   * Рендер сообщения
   */
  const renderMessage = ({item}) => {
    const isMine = item.isMine || item.from === username;
    const timestamp = new Date(item.timestamp);
    const timeString = timestamp.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <View
        style={[
          styles.messageContainer,
          isMine ? styles.myMessageContainer : styles.theirMessageContainer,
        ]}>
        <View
          style={[
            styles.messageBubble,
            isMine ? styles.myMessageBubble : styles.theirMessageBubble,
          ]}>
          <Text
            style={[
              styles.messageText,
              isMine ? styles.myMessageText : styles.theirMessageText,
            ]}>
            {item.message}
          </Text>
          <Text
            style={[
              styles.timestamp,
              isMine ? styles.myTimestamp : styles.theirTimestamp,
            ]}>
            {timeString}
          </Text>
        </View>
      </View>
    );
  };

  // handleContentSizeChange no longer needed — inverted FlatList handles this

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <StatusBar barStyle="light-content" backgroundColor="#667eea" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{targetUser}</Text>
          {isTyping && <Text style={styles.typingText}>печатает...</Text>}
          {!isConnected && (
            <Text style={styles.disconnectedText}>○ Нет соединения</Text>
          )}
        </View>
      </View>

      {/* Messages List */}
      {isLoadingHistory ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Загрузка сообщений...</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          inverted={true}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Input Area */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Введите сообщение..."
          placeholderTextColor="#999"
          value={inputText}
          onChangeText={handleTextChange}
          multiline
          maxLength={1000}
          editable={isConnected}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!inputText.trim() || !isConnected) && styles.sendButtonDisabled,
          ]}
          onPress={sendMessage}
          disabled={!inputText.trim() || !isConnected}>
          <Text style={styles.sendButtonText}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#667eea',
    padding: 15,
    paddingTop: 40,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 28,
    color: '#fff',
  },
  headerInfo: {
    flex: 1,
    marginLeft: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  typingText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 2,
  },
  disconnectedText: {
    fontSize: 14,
    color: '#FF5252',
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#999',
  },
  messagesList: {
    padding: 15,
    paddingBottom: 10,
  },
  messageContainer: {
    marginBottom: 15,
  },
  myMessageContainer: {
    alignItems: 'flex-end',
  },
  theirMessageContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '75%',
    padding: 12,
    borderRadius: 15,
  },
  myMessageBubble: {
    backgroundColor: '#667eea',
    borderBottomRightRadius: 5,
  },
  theirMessageBubble: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 5,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  myMessageText: {
    color: '#fff',
  },
  theirMessageText: {
    color: '#333',
  },
  timestamp: {
    fontSize: 11,
    marginTop: 5,
  },
  myTimestamp: {
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'right',
  },
  theirTimestamp: {
    color: '#999',
    textAlign: 'left',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginRight: 10,
    maxHeight: 100,
    fontSize: 16,
    color: '#333',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#667eea',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },
  sendButtonText: {
    fontSize: 24,
    color: '#fff',
  },
});