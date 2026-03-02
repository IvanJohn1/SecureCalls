import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  Dimensions,
} from 'react-native';
import SocketService from '../services/SocketService';
import NotificationService from '../services/NotificationService';

const {width, height} = Dimensions.get('window');

/**
 * CallScreen.windows.js — Windows Desktop
 *
 * react-native-webrtc не поддерживает Windows.
 * Экран показывает UI звонка (аватар, имя, статус, таймер),
 * но аудио/видео передача невозможна.
 * Сигнализация через Socket.IO работает корректно.
 */

console.log('[CallScreen.windows.js] LOADED — Windows desktop version (no WebRTC)');

export default function CallScreen({route, navigation}) {
  const {username, peer, isVideo, isCaller, callId: initialCallId} = route.params;

  const [callState, setCallState] = useState('initializing');
  const [callDuration, setCallDuration] = useState(0);

  const callTimerRef = useRef(null);
  const callTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);
  const isCleanedUpRef = useRef(false);
  const callIdRef = useRef(initialCallId || null);

  useEffect(() => {
    isMountedRef.current = true;
    isCleanedUpRef.current = false;

    NotificationService.cancelAllNotifications();
    setupListeners();

    if (isCaller) {
      setCallState('calling');
      // Таймаут на звонок — 60 сек
      callTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        Alert.alert('Нет ответа', 'Собеседник не отвечает', [
          {text: 'OK', onPress: handleEndCall},
        ]);
      }, 60000);
    } else {
      setCallState('connecting');
      // На Windows WebRTC не работает — показываем предупреждение
      setTimeout(() => {
        if (!isMountedRef.current) return;
        Alert.alert(
          'Ограничение Windows',
          'Аудио/видео звонки пока не поддерживаются в десктопной версии Windows.\n\nИспользуйте мобильное приложение для звонков.',
          [{text: 'Завершить', onPress: handleEndCall}],
        );
      }, 1500);
    }

    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, []);

  const setupListeners = () => {
    SocketService.on('call_accepted', handleCallAccepted);
    SocketService.on('call_rejected', handleCallRejected);
    SocketService.on('call_ended', handleCallEnded);
    SocketService.on('call_cancelled', handleCallCancelled);
    SocketService.on('call_initiated', handleCallInitiated);
    SocketService.on('call_ringing_offline', handleCallRingingOffline);
    SocketService.on('call_timeout', handleCallTimeout);
  };

  const cleanupListeners = () => {
    SocketService.off('call_accepted', handleCallAccepted);
    SocketService.off('call_rejected', handleCallRejected);
    SocketService.off('call_ended', handleCallEnded);
    SocketService.off('call_cancelled', handleCallCancelled);
    SocketService.off('call_initiated', handleCallInitiated);
    SocketService.off('call_ringing_offline', handleCallRingingOffline);
    SocketService.off('call_timeout', handleCallTimeout);
  };

  const handleCallInitiated = data => {
    if (data.to === peer) {
      callIdRef.current = data.callId;
    }
  };

  const handleCallRingingOffline = data => {
    if (data.to === peer || data.callId) {
      callIdRef.current = data.callId;
    }
  };

  const handleCallAccepted = () => {
    if (!isMountedRef.current) return;
    setCallState('connecting');
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    // На Windows WebRTC не работает — показываем предупреждение
    setTimeout(() => {
      if (!isMountedRef.current) return;
      Alert.alert(
        'Ограничение Windows',
        'Собеседник принял звонок, но аудио/видео связь невозможна в десктопной версии Windows.\n\nИспользуйте мобильное приложение для звонков.',
        [{text: 'Завершить', onPress: handleEndCall}],
      );
    }, 500);
  };

  const handleCallTimeout = () => {
    if (!isMountedRef.current) return;
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    Alert.alert('Нет ответа', 'Собеседник не отвечает', [
      {text: 'OK', onPress: () => { cleanup(); navigation.goBack(); }},
    ]);
  };

  const handleCallRejected = () => {
    if (!isMountedRef.current) return;
    Alert.alert('Звонок отклонён', 'Собеседник отклонил звонок', [
      {text: 'OK', onPress: () => navigation.goBack()},
    ]);
  };

  const handleCallEnded = () => {
    if (!isMountedRef.current) return;
    cleanup();
    navigation.goBack();
  };

  const handleCallCancelled = () => {
    if (!isMountedRef.current) return;
    cleanup();
    navigation.goBack();
  };

  const handleEndCall = () => {
    if (isCleanedUpRef.current) return;
    NotificationService.cancelAllNotifications();
    if (isCaller && callState === 'calling') {
      SocketService.cancelCall(peer, callIdRef.current);
    } else {
      SocketService.endCall(peer, callIdRef.current);
    }
    cleanup();
    navigation.goBack();
  };

  const cleanup = () => {
    if (isCleanedUpRef.current) return;
    isCleanedUpRef.current = true;
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    cleanupListeners();
  };

  const formatDuration = seconds => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStateText = () => {
    switch (callState) {
      case 'initializing': return 'Инициализация...';
      case 'calling': return 'Вызов...';
      case 'connecting': return 'Соединение...';
      case 'connected': return formatDuration(callDuration);
      case 'timeout': return 'Нет ответа';
      default: return '';
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <View style={styles.content}>
        {/* Аватар */}
        <View style={styles.avatarLarge}>
          <Text style={styles.avatarLargeText}>
            {peer.substring(0, 2).toUpperCase()}
          </Text>
        </View>

        {/* Имя и статус */}
        <Text style={styles.peerName}>{peer}</Text>
        <Text style={styles.callStateText}>{getStateText()}</Text>

        {/* Предупреждение Windows */}
        <View style={styles.warningContainer}>
          <Text style={styles.warningText}>
            Звонки пока не поддерживаются{'\n'}в десктопной версии Windows
          </Text>
        </View>
      </View>

      {/* Кнопка завершения */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.endCallButton}
          onPress={handleEndCall}>
          <Text style={styles.endCallIcon}>X</Text>
          <Text style={styles.endCallLabel}>Завершить</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLarge: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#667eea',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
  },
  avatarLargeText: {
    fontSize: 60,
    fontWeight: 'bold',
    color: '#fff',
  },
  peerName: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  callStateText: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 30,
  },
  warningContainer: {
    backgroundColor: 'rgba(255, 152, 0, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 152, 0, 0.4)',
    borderRadius: 12,
    paddingVertical: 15,
    paddingHorizontal: 25,
    marginHorizontal: 40,
  },
  warningText: {
    fontSize: 15,
    color: '#FFB74D',
    textAlign: 'center',
    lineHeight: 22,
  },
  controls: {
    paddingBottom: 60,
    alignItems: 'center',
  },
  endCallButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  endCallIcon: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
  },
  endCallLabel: {
    fontSize: 11,
    color: '#fff',
    marginTop: 8,
    fontWeight: '500',
  },
});
