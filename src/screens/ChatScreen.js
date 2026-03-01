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
  Image,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import SocketService from '../services/SocketService';
import {SERVER_URL} from '../config/server.config';
import {useTheme} from '../theme/ThemeContext';

/**
 * ═══════════════════════════════════════════════════════════
 * ChatScreen v10.0 — READ RECEIPTS + CLICKABLE LINKS +
 *                     MEDIA ATTACHMENTS + INLINE PREVIEW
 * ═══════════════════════════════════════════════════════════
 *
 * NEW:
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
console.log('║  ChatScreen v10.0 MEDIA + LINKS        ║');
console.log('╚════════════════════════════════════════╝');

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
  const {colors, isDark} = useTheme();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  const flatListRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    console.log('[ChatScreen v10.0] Открыт чат с:', targetUser);

    isMountedRef.current = true;

    if (!SocketService.isConnected()) {
      console.error('[ChatScreen] Нет подключения к серверу');
      Alert.alert('Ошибка', 'Нет подключения к серверу.', [
        {text: 'OK', onPress: () => navigation.goBack()},
      ]);
      return;
    }

    SocketService.getMessageHistory(targetUser);
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
   */
  const openLink = useCallback((url) => {
    Linking.canOpenURL(url).then(supported => {
      if (supported) {
        Linking.openURL(url);
      } else {
        Alert.alert('Ошибка', `Не удалось открыть: ${url}`);
      }
    });
  }, []);

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
            onPress={() => openLink(part.value)}>
            {part.value}
          </Text>
        );
      }
      return (
        <Text
          key={index}
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
   * Render message bubble
   */
  const renderMessage = ({item}) => {
    const isMine = item.isMine || item.from === username;
    const timestamp = new Date(item.timestamp);
    const timeString = timestamp.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const hasMedia = !!item.mediaUrl;
    const bubbleBg = isMine ? colors.myBubble : colors.theirBubble;
    const textColor = isMine ? colors.myBubbleText : colors.theirBubbleText;

    return (
      <View
        style={[
          styles.messageContainer,
          isMine ? styles.myMessageContainer : styles.theirMessageContainer,
        ]}>
        <View
          style={[
            styles.messageBubble,
            {backgroundColor: bubbleBg},
            isMine ? styles.myMessageBubble : styles.theirMessageBubble,
            hasMedia && styles.mediaBubble,
          ]}>
          {renderMediaPreview(item)}

          {item.message && !(hasMedia && (item.message === '\u{1F4F7} Фото' || item.message === '\u{1F4F9} Видео')) && (
            <Text>
              {renderMessageTextWithLinks(item.message, isMine)}
            </Text>
          )}

          <View style={styles.timestampRow}>
            <Text
              style={[
                styles.timestamp,
                {color: isMine ? 'rgba(255,255,255,0.6)' : colors.textHint},
              ]}>
              {timeString}
            </Text>
            {renderMessageStatus(item)}
          </View>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, {backgroundColor: colors.background}]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <StatusBar barStyle="light-content" backgroundColor={colors.headerBg} />

      {/* Header */}
      <View style={[styles.header, {backgroundColor: colors.headerBg}]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}>
          <Text style={[styles.backButtonText, {color: colors.textOnHeader}]}>{'<-'}</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, {color: colors.textOnHeader}]}>{targetUser}</Text>
          {isTyping && <Text style={[styles.typingText, {color: colors.textOnHeaderHint}]}>печатает...</Text>}
          {!isConnected && (
            <Text style={[styles.disconnectedText, {color: colors.error}]}>Нет соединения</Text>
          )}
        </View>
      </View>

      {/* Messages List */}
      {isLoadingHistory ? (
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, {color: colors.textHint}]}>Загрузка сообщений...</Text>
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
        <View style={[styles.uploadingBar, {backgroundColor: colors.primaryLight}]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.uploadingText, {color: colors.primary}]}>Загрузка файла...</Text>
        </View>
      )}

      {/* Input Area */}
      <View style={[styles.inputContainer, {backgroundColor: colors.card, borderTopColor: colors.border}]}>
        <TouchableOpacity
          style={styles.attachButton}
          onPress={pickMedia}
          disabled={isUploading}>
          <Text style={styles.attachButtonText}>{'\u{1F4CE}'}</Text>
        </TouchableOpacity>

        <TextInput
          style={[styles.input, {backgroundColor: colors.inputBg, color: colors.text}]}
          placeholder="Введите сообщение..."
          placeholderTextColor={colors.textHint}
          value={inputText}
          onChangeText={handleTextChange}
          multiline
          maxLength={1000}
          editable={isConnected}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            {backgroundColor: colors.primary},
            (!inputText.trim() || !isConnected) && {backgroundColor: colors.buttonDisabled},
          ]}
          onPress={sendMessage}
          disabled={!inputText.trim() || !isConnected}>
          <Text style={styles.sendButtonText}>{'\u{27A4}'}</Text>
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
