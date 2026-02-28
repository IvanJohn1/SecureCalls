import React, {useState, useEffect, useRef, useCallback} from 'react';
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
  Linking,
  Share,
  Image,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import SocketService from '../services/SocketService';
import {SERVER_URL} from '../config/server.config';

/**
 * ═══════════════════════════════════════════════════════════
 * ChatScreen v11.0 — SELECTABLE TEXT + DATES + LAST SEEN
 * ═══════════════════════════════════════════════════════════
 *
 * v11.0:
 * 1. All message text is selectable/copyable (not just links)
 * 2. Date separators between message groups
 * 3. Last seen online status in header
 *
 * v10.0:
 * 1. Message status: ✓ sent, ✓✓ delivered, ✓✓ (blue) read
 * 2. URLs in messages are clickable (auto-detected)
 * 3. Media attachments: photo/video from gallery
 * 4. Inline image preview (compressed like Telegram)
 * 5. Video thumbnail with play icon
 */

const {width: SCREEN_WIDTH} = Dimensions.get('window');
const MAX_IMAGE_WIDTH = SCREEN_WIDTH * 0.6;

// URL regex for auto-detection
const URL_REGEX = /(https?:\/\/[^\s<>\"\']+)/gi;

console.log('╔════════════════════════════════════════╗');
console.log('║  ChatScreen v11.0 SELECTABLE + DATES   ║');
console.log('╚════════════════════════════════════════╝');

/**
 * Date helpers
 */
function isSameDay(d1, d2) {
  return d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear();
}

function formatMessageDate(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameDay(date, today)) return 'Сегодня';
  if (isSameDay(date, yesterday)) return 'Вчера';

  const options = {day: 'numeric', month: 'long'};
  if (date.getFullYear() !== today.getFullYear()) {
    options.year = 'numeric';
  }
  return date.toLocaleDateString('ru-RU', options);
}

function formatLastSeen(timestamp) {
  if (!timestamp) return 'не в сети';

  const date = new Date(timestamp);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const time = date.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});

  if (isSameDay(date, now)) return `был(а) сегодня в ${time}`;
  if (isSameDay(date, yesterday)) return `был(а) вчера в ${time}`;

  const dateStr = date.toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'});
  return `был(а) ${dateStr} в ${time}`;
}

/**
 * Parse message text into segments: text and links
 */
function parseMessageText(text) {
  if (!text) return [{type: 'text', value: ''}];

  const parts = [];
  let lastIndex = 0;
  let match;

  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({type: 'text', value: text.substring(lastIndex, match.index)});
    }
    parts.push({type: 'link', value: match[0]});
    lastIndex = URL_REGEX.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({type: 'text', value: text.substring(lastIndex)});
  }

  return parts.length > 0 ? parts : [{type: 'text', value: text}];
}

export default function ChatScreen({route, navigation}) {
  const {username, targetUser} = route.params;
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [peerOnline, setPeerOnline] = useState(null);
  const [peerLastSeen, setPeerLastSeen] = useState(null);

  const flatListRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    console.log('[ChatScreen v11.0] Открыт чат с:', targetUser);

    isMountedRef.current = true;

    if (!SocketService.isConnected()) {
      console.error('[ChatScreen] Нет подключения к серверу');
      Alert.alert('Ошибка', 'Нет подключения к серверу.', [
        {text: 'OK', onPress: () => navigation.goBack()},
      ]);
      return;
    }

    SocketService.getMessageHistory(targetUser);
    SocketService.getUsers(true); // request user list to get peer status
    setupSocketListeners();

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
    SocketService.on('messages_read', handleMessagesRead);
    SocketService.on('message_delivered', handleMessageDelivered);
    SocketService.on('disconnect', handleDisconnect);
    SocketService.on('connect', handleReconnect);
    SocketService.on('users_list', handleUsersList);
    SocketService.on('user_online', handleUserOnline);
    SocketService.on('user_offline', handleUserOffline);
  };

  const cleanupSocketListeners = () => {
    SocketService.off('message_history', handleMessageHistory);
    SocketService.off('new_message', handleNewMessage);
    SocketService.off('typing', handleTyping);
    SocketService.off('message_sent', handleMessageSent);
    SocketService.off('messages_read', handleMessagesRead);
    SocketService.off('message_delivered', handleMessageDelivered);
    SocketService.off('disconnect', handleDisconnect);
    SocketService.off('connect', handleReconnect);
    SocketService.off('users_list', handleUsersList);
    SocketService.off('user_online', handleUserOnline);
    SocketService.off('user_offline', handleUserOffline);
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
      SocketService.getUsers(true);
    }
  };

  const handleUsersList = (usersList) => {
    if (!isMountedRef.current) return;
    const peer = usersList.find(u => u.username === targetUser);
    if (peer) {
      const online = peer.isOnline || peer.online;
      setPeerOnline(online);
      if (!online && peer.lastSeen) {
        setPeerLastSeen(peer.lastSeen);
      } else if (!online && !peer.lastSeen) {
        // Server didn't send lastSeen, keep existing
      }
    }
  };

  const handleUserOnline = (data) => {
    if (!isMountedRef.current) return;
    if (data.username === targetUser) {
      setPeerOnline(true);
    }
  };

  const handleUserOffline = (data) => {
    if (!isMountedRef.current) return;
    if (data.username === targetUser) {
      setPeerOnline(false);
      setPeerLastSeen(data.lastSeen || Date.now());
    }
  };

  const handleMessageHistory = data => {
    if (!isMountedRef.current) return;

    if (data.withUser === targetUser) {
      console.log('[ChatScreen] Получена история:', data.messages.length, 'сообщений');

      const formattedMessages = data.messages.map(msg => ({
        id: msg.id || msg.messageId || msg.timestamp?.toString() || Math.random().toString(),
        from: msg.from,
        to: msg.to,
        message: msg.message,
        timestamp: msg.timestamp,
        isMine: msg.from === username,
        delivered: msg.delivered || false,
        read: msg.read || false,
        mediaUrl: msg.mediaUrl || null,
        mediaType: msg.mediaType || null,
        thumbnailUrl: msg.thumbnailUrl || null,
        fileName: msg.fileName || null,
        fileSize: msg.fileSize || null,
      }));

      setMessages(formattedMessages);
      setIsLoadingHistory(false);
    }
  };

  const handleNewMessage = data => {
    if (!isMountedRef.current) return;

    if (data.from === targetUser) {
      console.log('[ChatScreen] Новое сообщение от:', data.from);

      const newMessage = {
        id: data.messageId || Date.now().toString(),
        from: data.from,
        to: username,
        message: data.message,
        timestamp: data.timestamp || Date.now(),
        isMine: false,
        delivered: true,
        read: false,
        mediaUrl: data.mediaUrl || null,
        mediaType: data.mediaType || null,
        thumbnailUrl: data.thumbnailUrl || null,
        fileName: data.fileName || null,
        fileSize: data.fileSize || null,
      };

      setMessages(prev => [newMessage, ...prev]);

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

  const handleMessageSent = data => {
    if (!isMountedRef.current) return;

    if (data.to !== targetUser) return;

    console.log('[ChatScreen] Сообщение отправлено:', data.messageId);

    const sentMessage = {
      id: data.messageId || Date.now().toString(),
      from: username,
      to: targetUser,
      message: data.message,
      timestamp: data.timestamp || Date.now(),
      isMine: true,
      delivered: data.delivered || false,
      read: false,
      mediaUrl: data.mediaUrl || null,
      mediaType: data.mediaType || null,
      thumbnailUrl: data.thumbnailUrl || null,
    };

    setMessages(prev => [sentMessage, ...prev]);
  };

  // [v10.0] Handle read receipts from server
  const handleMessagesRead = data => {
    if (!isMountedRef.current) return;

    if (data.by === targetUser) {
      console.log('[ChatScreen] Сообщения прочитаны:', targetUser);
      setMessages(prev =>
        prev.map(msg =>
          msg.isMine && !msg.read
            ? {...msg, read: true, delivered: true}
            : msg
        )
      );
    }
  };

  // [v10.0] Handle delivery confirmation
  const handleMessageDelivered = data => {
    if (!isMountedRef.current) return;

    if (data.to === targetUser && data.messageId) {
      setMessages(prev =>
        prev.map(msg =>
          msg.id === data.messageId ? {...msg, delivered: true} : msg
        )
      );
    }
  };

  const sendMessage = () => {
    if (!inputText.trim()) return;

    if (!SocketService.isConnected()) {
      Alert.alert('Ошибка', 'Нет подключения к серверу');
      return;
    }

    console.log('[ChatScreen] Отправка:', inputText);

    const sent = SocketService.sendMessage(targetUser, inputText.trim());
    if (!sent) {
      Alert.alert('Ошибка', 'Не удалось отправить сообщение.');
      return;
    }

    setInputText('');
    SocketService.sendTyping(targetUser, false);
  };

  /**
   * [v10.0] Pick and send media from gallery
   */
  const pickMedia = async () => {
    if (!SocketService.isConnected()) {
      Alert.alert('Ошибка', 'Нет подключения к серверу');
      return;
    }

    try {
      // Dynamic import to avoid crash if library not installed
      const ImagePicker = require('react-native-image-picker');

      ImagePicker.launchImageLibrary(
        {
          mediaType: 'mixed',
          maxWidth: 1280,
          maxHeight: 1280,
          quality: 0.7, // Compression like Telegram
          videoQuality: 'medium',
          includeBase64: false,
        },
        async (response) => {
          if (response.didCancel) return;
          if (response.errorCode) {
            console.error('[ChatScreen] ImagePicker error:', response.errorMessage);
            Alert.alert('Ошибка', 'Не удалось выбрать файл');
            return;
          }

          const asset = response.assets?.[0];
          if (!asset) return;

          console.log('[ChatScreen] Выбрано:', asset.type, asset.fileSize, 'байт');

          setIsUploading(true);
          try {
            const formData = new FormData();
            formData.append('media', {
              uri: asset.uri,
              type: asset.type || 'image/jpeg',
              name: asset.fileName || `media_${Date.now()}.jpg`,
            });

            const uploadRes = await fetch(`${SERVER_URL}/upload/media`, {
              method: 'POST',
              body: formData,
              headers: {
                'Content-Type': 'multipart/form-data',
              },
            });

            const uploadData = await uploadRes.json();

            if (uploadData.success) {
              console.log('[ChatScreen] Загружено:', uploadData.mediaUrl);

              SocketService.sendMediaMessage(
                targetUser,
                uploadData.mediaUrl,
                uploadData.mediaType,
                uploadData.fileName,
                uploadData.fileSize,
                null, // thumbnailUrl — server could generate
              );
            } else {
              Alert.alert('Ошибка', 'Не удалось загрузить файл');
            }
          } catch (uploadError) {
            console.error('[ChatScreen] Upload error:', uploadError);
            Alert.alert('Ошибка', 'Ошибка загрузки файла');
          } finally {
            setIsUploading(false);
          }
        }
      );
    } catch (e) {
      console.warn('[ChatScreen] react-native-image-picker не установлен:', e.message);
      Alert.alert(
        'Медиафайлы',
        'Для отправки фото и видео установите react-native-image-picker:\nnpm install react-native-image-picker'
      );
    }
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
   * Open URL in browser
   * FIX: Don't use canOpenURL() — it returns false on many Android devices
   * due to package visibility restrictions (Android 11+). Just try openURL directly.
   */
  const openLink = useCallback((url) => {
    Linking.openURL(url).catch(err => {
      console.error('[ChatScreen] openURL error:', err);
      Alert.alert('Ошибка', `Не удалось открыть ссылку.\n\nВы можете скопировать её через долгое нажатие.`);
    });
  }, []);

  /**
   * Long-press on link: show options (Open / Copy / Cancel)
   */
  const handleLinkLongPress = useCallback((url) => {
    Alert.alert(
      'Ссылка',
      url,
      [
        {
          text: 'Открыть',
          onPress: () => openLink(url),
        },
        {
          text: 'Копировать',
          onPress: () => {
            Share.share({message: url}).catch(() => {});
          },
        },
        {text: 'Отмена', style: 'cancel'},
      ],
    );
  }, [openLink]);

  /**
   * Render message text with clickable links
   */
  const renderMessageTextWithLinks = (text, isMine) => {
    const parts = parseMessageText(text);

    return parts.map((part, index) => {
      if (part.type === 'link') {
        return (
          <Text
            key={index}
            style={[
              styles.messageText,
              isMine ? styles.myMessageText : styles.theirMessageText,
              styles.linkText,
            ]}
            onPress={() => openLink(part.value)}
            onLongPress={() => handleLinkLongPress(part.value)}>
            {part.value}
          </Text>
        );
      }
      return (
        <Text
          key={index}
          selectable={true}
          style={[
            styles.messageText,
            isMine ? styles.myMessageText : styles.theirMessageText,
          ]}>
          {part.value}
        </Text>
      );
    });
  };

  /**
   * Render inline media preview
   */
  const renderMediaPreview = (item) => {
    if (!item.mediaUrl) return null;

    const fullUrl = item.mediaUrl.startsWith('http')
      ? item.mediaUrl
      : `${SERVER_URL}${item.mediaUrl}`;

    if (item.mediaType === 'video') {
      return (
        <TouchableOpacity
          style={styles.mediaContainer}
          onPress={() => openLink(fullUrl)}>
          <View style={styles.videoPlaceholder}>
            <Text style={styles.videoPlayIcon}>▶</Text>
            <Text style={styles.videoLabel}>Видео</Text>
            {item.fileSize && (
              <Text style={styles.fileSizeLabel}>
                {(item.fileSize / (1024 * 1024)).toFixed(1)} МБ
              </Text>
            )}
          </View>
        </TouchableOpacity>
      );
    }

    // Image preview — inline like Telegram
    return (
      <TouchableOpacity
        style={styles.mediaContainer}
        onPress={() => openLink(fullUrl)}>
        <Image
          source={{uri: fullUrl}}
          style={styles.mediaImage}
          resizeMode="cover"
        />
      </TouchableOpacity>
    );
  };

  /**
   * Render message status indicators (checkmarks)
   */
  const renderMessageStatus = (item) => {
    if (!item.isMine) return null;

    if (item.read) {
      return <Text style={styles.statusRead}>✓✓</Text>;
    }
    if (item.delivered) {
      return <Text style={styles.statusDelivered}>✓✓</Text>;
    }
    return <Text style={styles.statusSent}>✓</Text>;
  };

  /**
   * Render message bubble with date separators
   */
  const renderMessage = ({item, index}) => {
    const isMine = item.isMine || item.from === username;
    const timestamp = new Date(item.timestamp);
    const timeString = timestamp.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const hasMedia = !!item.mediaUrl;

    // Date separator: in inverted list, index+1 is visually above (older)
    // Show separator when the next (older) message is from a different day, or this is the oldest message
    const nextMessage = messages[index + 1];
    const showDateSeparator = !nextMessage || !isSameDay(timestamp, new Date(nextMessage.timestamp));

    return (
      <View>
        {/* Message bubble */}
        <View
          style={[
            styles.messageContainer,
            isMine ? styles.myMessageContainer : styles.theirMessageContainer,
          ]}>
          <View
            style={[
              styles.messageBubble,
              isMine ? styles.myMessageBubble : styles.theirMessageBubble,
              hasMedia && styles.mediaBubble,
            ]}>
            {/* Media preview */}
            {renderMediaPreview(item)}

            {/* Message text with clickable links — selectable for copy */}
            {item.message && !(hasMedia && (item.message === '📷 Фото' || item.message === '📹 Видео')) && (
              <Text selectable={true}>
                {renderMessageTextWithLinks(item.message, isMine)}
              </Text>
            )}

            {/* Timestamp + status row */}
            <View style={styles.timestampRow}>
              <Text
                style={[
                  styles.timestamp,
                  isMine ? styles.myTimestamp : styles.theirTimestamp,
                ]}>
                {timeString}
              </Text>
              {renderMessageStatus(item)}
            </View>
          </View>
        </View>

        {/* Date separator (visually above this group in inverted list) */}
        {showDateSeparator && (
          <View style={styles.dateSeparator}>
            <View style={styles.dateSeparatorLine} />
            <Text style={styles.dateSeparatorText}>
              {formatMessageDate(timestamp)}
            </Text>
            <View style={styles.dateSeparatorLine} />
          </View>
        )}
      </View>
    );
  };

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
          {!isConnected ? (
            <Text style={styles.disconnectedText}>○ Нет соединения</Text>
          ) : isTyping ? (
            <Text style={styles.typingText}>печатает...</Text>
          ) : peerOnline === true ? (
            <Text style={styles.onlineText}>в сети</Text>
          ) : peerOnline === false ? (
            <Text style={styles.lastSeenText}>{formatLastSeen(peerLastSeen)}</Text>
          ) : null}
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

      {/* Upload indicator */}
      {isUploading && (
        <View style={styles.uploadingBar}>
          <ActivityIndicator size="small" color="#667eea" />
          <Text style={styles.uploadingText}>Загрузка файла...</Text>
        </View>
      )}

      {/* Input Area */}
      <View style={styles.inputContainer}>
        {/* Attachment button */}
        <TouchableOpacity
          style={styles.attachButton}
          onPress={pickMedia}
          disabled={isUploading}>
          <Text style={styles.attachButtonText}>📎</Text>
        </TouchableOpacity>

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
  onlineText: {
    fontSize: 14,
    color: '#81C784',
    marginTop: 2,
  },
  lastSeenText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.65)',
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
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 15,
    paddingHorizontal: 20,
  },
  dateSeparatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#d0d0d0',
  },
  dateSeparatorText: {
    fontSize: 13,
    color: '#888',
    marginHorizontal: 12,
    fontWeight: '500',
  },
  messageContainer: {
    marginBottom: 10,
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
  mediaBubble: {
    padding: 4,
    paddingBottom: 8,
    overflow: 'hidden',
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
  linkText: {
    textDecorationLine: 'underline',
    fontWeight: '500',
  },
  timestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    gap: 4,
  },
  timestamp: {
    fontSize: 11,
  },
  myTimestamp: {
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'right',
  },
  theirTimestamp: {
    color: '#999',
    textAlign: 'left',
  },
  // Message status indicators
  statusSent: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  statusDelivered: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  statusRead: {
    fontSize: 12,
    color: '#90CAF9', // Blue checkmarks like WhatsApp
  },
  // Media
  mediaContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 4,
  },
  mediaImage: {
    width: MAX_IMAGE_WIDTH,
    height: MAX_IMAGE_WIDTH * 0.75,
    borderRadius: 12,
    backgroundColor: '#e0e0e0',
  },
  videoPlaceholder: {
    width: MAX_IMAGE_WIDTH,
    height: MAX_IMAGE_WIDTH * 0.5,
    backgroundColor: '#333',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayIcon: {
    fontSize: 40,
    color: '#fff',
  },
  videoLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 4,
  },
  fileSizeLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
  // Upload indicator
  uploadingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    backgroundColor: '#E8EAF6',
  },
  uploadingText: {
    fontSize: 13,
    color: '#667eea',
    marginLeft: 8,
  },
  // Input area
  inputContainer: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    alignItems: 'flex-end',
  },
  attachButton: {
    width: 40,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachButtonText: {
    fontSize: 24,
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
