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
import {RTCView} from 'react-native-webrtc';
import SocketService from '../services/SocketService';
import WebRTCService from '../services/WebRTCService';
import NotificationService from '../services/NotificationService';
import ConnectionService from '../services/ConnectionService';

const {width, height} = Dimensions.get('window');

/**
 * ═══════════════════════════════════════════════════════════
 * CallScreen v8.0 FIX - ИСПРАВЛЕНИЕ OFFER/ANSWER + ICE
 * ═══════════════════════════════════════════════════════════
 *
 * КРИТИЧНЫЕ ИСПРАВЛЕНИЯ:
 * 1. Caller ждёт call_accepted ПЕРЕД отправкой offer
 *    → ICE candidates не теряются
 * 2. Receiver обрабатывает offer из params ИЛИ через сокет
 * 3. Правильные переходы состояний для обоих сторон
 * 4. Защита от повторных offer/answer
 */

console.log('╔════════════════════════════════════════╗');
console.log('║  CallScreen v8.0 FIX                  ║');
console.log('╚════════════════════════════════════════╝');

export default function CallScreen({route, navigation}) {
  // [FIX v11.0] callId берётся из params; для caller-стороны также приходит через call_initiated
  const {username, peer, isVideo, isCaller, offer, callId: initialCallId} = route.params;

  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callState, setCallState] = useState('initializing');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(isVideo);
  const [callDuration, setCallDuration] = useState(0);

  const callTimerRef = useRef(null);
  const callTimeoutRef = useRef(null);
  const answerSentRef = useRef(false);
  const offerSentRef = useRef(false);
  const isMountedRef = useRef(true);
  const isCleanedUpRef = useRef(false);
  // [NEW v11.0] callId ref: заполняется из params (receiver) или через call_initiated (caller)
  const callIdRef = useRef(initialCallId || null);
  // [FIX] callStateRef to avoid stale closures in WebRTC/ICE callbacks
  const callStateRef = useRef('initializing');

  // Helper: update callState + ref atomically, never downgrade from 'connected'
  const updateCallState = (newState) => {
    if (callStateRef.current === 'connected' && newState === 'connecting') {
      return; // never downgrade from connected to connecting
    }
    callStateRef.current = newState;
    setCallState(newState);
  };

  useEffect(() => {
    console.log('═══════════════════════════════════════');
    console.log('CallScreen v8.0: МОНТИРОВАНИЕ');
    console.log('Пользователь:', username);
    console.log('Собеседник:', peer);
    console.log('Видео:', isVideo);
    console.log('Звонящий:', isCaller);
    console.log('Offer в params:', !!offer);
    console.log('═══════════════════════════════════════');

    isMountedRef.current = true;
    isCleanedUpRef.current = false;

    // Отменить уведомления
    NotificationService.cancelAllNotifications();

    // Инициализация
    initialize();

    // Таймаут на весь звонок (60 сек) — только если звоним
    if (isCaller) {
      callTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        console.log('⏰ Таймаут звонка (60 сек)');
        Alert.alert('Нет ответа', 'Собеседник не отвечает', [
          {text: 'OK', onPress: handleEndCall},
        ]);
      }, 60000);
    }

    return () => {
      console.log('CallScreen v8.0: РАЗМОНТИРОВАНИЕ');
      isMountedRef.current = false;
      cleanup();
    };
  }, []);

  /**
   * Инициализация звонка
   */
  const initialize = async () => {
    try {
      console.log('CallScreen v8.0: ИНИЦИАЛИЗАЦИЯ');

      // 1. Загрузить ICE/TURN конфигурацию с сервера (Signal-style)
      console.log('→ Шаг 1: Загрузка ICE конфигурации...');
      await WebRTCService.fetchIceServers();
      if (!isMountedRef.current) return;
      console.log('✓ Шаг 1: ICE конфигурация загружена');

      // 2. Получить локальный поток
      console.log('→ Шаг 2: Получение медиа...');
      const stream = await WebRTCService.getLocalStream(isVideo);
      if (!isMountedRef.current) return;
      setLocalStream(stream);
      console.log('✓ Шаг 2: Медиа получено');

      // 3. Создать PeerConnection
      console.log('→ Шаг 3: Создание PeerConnection...');
      WebRTCService.createPeerConnection();
      console.log('✓ Шаг 3: PeerConnection создан');

      // 4. Настроить слушателей
      console.log('→ Шаг 4: Настройка слушателей...');
      setupListeners();
      console.log('✓ Шаг 4: Слушатели настроены');

      // 5. Обработка в зависимости от роли
      if (isCaller) {
        // ═══════════════════════════════════════
        // ЗВОНЯЩИЙ: ЖДЁМ call_accepted, потом offer
        // ═══════════════════════════════════════
        console.log('→ Шаг 5: Ожидание принятия звонка...');
        if (!isMountedRef.current) return;
        updateCallState('calling');
        // callId придёт через call_initiated (слушатель настроен выше)
        // Offer будет создан когда придёт call_accepted (см. handleCallAccepted)
      } else {
        // ═══════════════════════════════════════
        // ПРИНИМАЮЩИЙ: обработать offer
        // ═══════════════════════════════════════
        if (!isMountedRef.current) return;
        updateCallState('connecting');

        if (offer) {
          console.log('→ Шаг 5: Обработка offer из params...');
          // Небольшая задержка чтобы PeerConnection стабилизировался
          await new Promise(resolve => setTimeout(resolve, 300));
          if (!isMountedRef.current) return;
          await handleOfferAndSendAnswer(offer);
        } else {
          console.log('→ Шаг 5: Ожидание offer через сокет...');
        }
      }

      console.log('CallScreen v11.0: ИНИЦИАЛИЗАЦИЯ ЗАВЕРШЕНА');
    } catch (error) {
      console.error('CallScreen v11.0: ОШИБКА ИНИЦИАЛИЗАЦИИ:', error.message);
      if (!isMountedRef.current) return;
      Alert.alert('Ошибка инициализации', error.message, [
        {text: 'OK', onPress: () => navigation.goBack()},
      ]);
    }
  };

  // ═══════════════════════════════════════
  // [NEW v11.0] callId handlers
  // ═══════════════════════════════════════

  /**
   * Получаем callId от сервера (для caller-стороны при online звонке)
   */
  const handleCallInitiated = data => {
    if (data.to === peer) {
      callIdRef.current = data.callId;
      console.log('CallScreen v11.0: callId получен (call_initiated):', data.callId);
    }
  };

  /**
   * Получаем callId когда адресат offline (через push)
   */
  const handleCallRingingOffline = data => {
    if (data.to === peer || data.callId) {
      callIdRef.current = data.callId;
      console.log('CallScreen v11.0: callId получен (call_ringing_offline):', data.callId);
    }
  };

  /**
   * Сервер отменил звонок по таймауту (30 сек без ответа)
   */
  const handleCallTimeout = data => {
    if (!isMountedRef.current) return;
    console.log('CallScreen: Timeout from server');
    // Cancel client timeout to avoid double Alert
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    if (!isCleanedUpRef.current) {
      updateCallState('timeout');
      Alert.alert('Нет ответа', 'Собеседник не отвечает', [
        {text: 'OK', onPress: () => { cleanup(); navigation.goBack(); }},
      ]);
    }
  };

  /**
   * КРИТИЧНО: Когда собеседник принял звонок — создаём offer
   */
  const handleCallAccepted = async data => {
    if (!isMountedRef.current) return;
    if (offerSentRef.current) {
      console.log('⚠️ Offer уже отправлен, игнорируем повторный call_accepted');
      return;
    }

    console.log('═══════════════════════════════════════');
    console.log('CallScreen v8.0: ЗВОНОК ПРИНЯТ — СОЗДАЁМ OFFER');
    console.log('═══════════════════════════════════════');

    try {
      offerSentRef.current = true;
      if (!isMountedRef.current) return;
      updateCallState('connecting');

      // Задержка для стабилизации (receiver должен успеть подготовить PeerConnection)
      await new Promise(resolve => setTimeout(resolve, 800));
      if (!isMountedRef.current) return;

      const createdOffer = await WebRTCService.createOffer();
      if (!isMountedRef.current) return;

      SocketService.sendWebRTCOffer(peer, createdOffer);
      console.log('✓ Offer отправлен собеседнику ПОСЛЕ принятия звонка');
    } catch (error) {
      console.error('✗ Ошибка создания offer:', error);
      offerSentRef.current = false;
    }
  };

  /**
   * КРИТИЧНО: Обработка offer и отправка answer
   */
  const handleOfferAndSendAnswer = async offerData => {
    if (answerSentRef.current) {
      console.log('⚠️ Answer уже был отправлен, пропускаем');
      return;
    }

    try {
      console.log('CallScreen v8.0: ОБРАБОТКА OFFER → СОЗДАНИЕ ANSWER');

      const answer = await WebRTCService.createAnswer(offerData);
      if (!isMountedRef.current) return;

      const sent = SocketService.sendWebRTCAnswer(peer, answer);
      if (sent) {
        answerSentRef.current = true;
        console.log('✓ Answer успешно отправлен');
      } else {
        console.error('✗ Не удалось отправить answer (сокет отключён?)');
      }
    } catch (error) {
      console.error('✗ Ошибка обработки offer:', error);
    }
  };

  /**
   * Настройка слушателей
   */
  const setupListeners = () => {
    // WebRTC события
    WebRTCService.on('remoteStream', handleRemoteStream);
    WebRTCService.on('iceCandidate', handleLocalIceCandidate);
    WebRTCService.on('iceConnectionStateChange', handleIceStateChange);
    WebRTCService.on('connectionStateChange', handleConnectionStateChange);

    // Socket события
    SocketService.on('call_accepted', handleCallAccepted);     // ← КЛЮЧЕВОЕ!
    SocketService.on('webrtc_offer', handleOffer);
    SocketService.on('webrtc_answer', handleAnswer);
    SocketService.on('ice_candidate', handleRemoteIceCandidate);
    SocketService.on('call_rejected', handleCallRejected);
    SocketService.on('call_ended', handleCallEnded);
    SocketService.on('call_cancelled', handleCallCancelled);
    // [NEW v11.0] callId events
    SocketService.on('call_initiated', handleCallInitiated);
    SocketService.on('call_ringing_offline', handleCallRingingOffline);
    SocketService.on('call_timeout', handleCallTimeout);
  };

  const cleanupListeners = () => {
    WebRTCService.off('remoteStream', handleRemoteStream);
    WebRTCService.off('iceCandidate', handleLocalIceCandidate);
    WebRTCService.off('iceConnectionStateChange', handleIceStateChange);
    WebRTCService.off('connectionStateChange', handleConnectionStateChange);

    SocketService.off('call_accepted', handleCallAccepted);
    SocketService.off('webrtc_offer', handleOffer);
    SocketService.off('webrtc_answer', handleAnswer);
    SocketService.off('ice_candidate', handleRemoteIceCandidate);
    SocketService.off('call_rejected', handleCallRejected);
    SocketService.off('call_ended', handleCallEnded);
    SocketService.off('call_cancelled', handleCallCancelled);
    SocketService.off('call_initiated', handleCallInitiated);
    SocketService.off('call_ringing_offline', handleCallRingingOffline);
    SocketService.off('call_timeout', handleCallTimeout);
  };

  // ═══════════════════════════════════════
  // WebRTC обработчики
  // ═══════════════════════════════════════

  const handleRemoteStream = stream => {
    if (!isMountedRef.current) return;

    console.log('═══════════════════════════════════════');
    console.log('CallScreen v8.0: УДАЛЁННЫЙ ПОТОК ПОЛУЧЕН!');
    console.log('═══════════════════════════════════════');

    setRemoteStream(stream);
    updateCallState('connected');

    // Очистить таймаут
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }

    // Запустить таймер длительности
    startCallTimer();
  };

  const handleLocalIceCandidate = candidate => {
    SocketService.sendIceCandidate(peer, candidate);
  };

  const handleIceStateChange = state => {
    if (!isMountedRef.current) return;
    console.log('→ ICE состояние:', state);

    if (state === 'connected' || state === 'completed') {
      // [FIX] ICE connected — set 'connected' state (use ref to avoid stale closure)
      if (callStateRef.current !== 'connected') {
        console.log('✓ ICE connected — обновляем статус');
        updateCallState('connected');
        // Clear timeout
        if (callTimeoutRef.current) {
          clearTimeout(callTimeoutRef.current);
          callTimeoutRef.current = null;
        }
        startCallTimer();
      }
    }
  };

  const handleConnectionStateChange = state => {
    if (!isMountedRef.current) return;
    console.log('→ Connection состояние:', state);

    if (state === 'connecting') {
      // [FIX] Use ref to check real state — never downgrade from 'connected'
      if (callStateRef.current !== 'connected') {
        updateCallState('connecting');
      }
    }

    if (state === 'connected' && callStateRef.current !== 'connected') {
      console.log('P2P connected');
      updateCallState('connected');
      // Clear timeout
      if (callTimeoutRef.current) {
        clearTimeout(callTimeoutRef.current);
        callTimeoutRef.current = null;
      }
      startCallTimer();
    }

    if (state === 'disconnected' || state === 'failed') {
      if (isCleanedUpRef.current) return;
      Alert.alert('Соединение потеряно', 'Связь с собеседником прервана', [
        {text: 'OK', onPress: handleEndCall},
      ]);
    }
  };

  // ═══════════════════════════════════════
  // Socket обработчики
  // ═══════════════════════════════════════

  const handleOffer = async data => {
    if (data.from !== peer) return;
    if (!isMountedRef.current) return;

    console.log('CallScreen v8.0: ПОЛУЧЕН OFFER ЧЕРЕЗ СОКЕТ от:', data.from);
    await handleOfferAndSendAnswer(data.offer);
  };

  const handleAnswer = async data => {
    if (data.from !== peer) return;
    if (!isMountedRef.current) return;

    console.log('═══════════════════════════════════════');
    console.log('CallScreen v8.0: ПОЛУЧЕН ANSWER от:', data.from);
    console.log('═══════════════════════════════════════');

    try {
      await WebRTCService.setRemoteAnswer(data.answer);
      console.log('✓ Answer обработан, ожидаем подключение...');
      // [FIX] Don't downgrade from 'connected' — use updateCallState which guards this
      if (isMountedRef.current) {
        updateCallState('connecting');
      }
    } catch (error) {
      console.error('✗ Ошибка обработки answer:', error);
    }
  };

  const handleRemoteIceCandidate = async data => {
    if (data.from !== peer) return;

    try {
      await WebRTCService.addIceCandidate(data.candidate);
    } catch (error) {
      console.warn('⚠️ Ошибка добавления ICE:', error.message);
    }
  };

  const handleCallRejected = data => {
    if (!isMountedRef.current) return;
    console.log('✗ Звонок отклонён');
    Alert.alert('Звонок отклонён', 'Собеседник отклонил звонок', [
      {text: 'OK', onPress: () => navigation.goBack()},
    ]);
  };

  const handleCallEnded = data => {
    if (!isMountedRef.current) return;
    console.log('✗ Звонок завершён собеседником');
    cleanup();
    navigation.goBack();
  };

  const handleCallCancelled = data => {
    if (!isMountedRef.current) return;
    console.log('✗ Звонок отменён');
    cleanup();
    navigation.goBack();
  };

  // ═══════════════════════════════════════
  // Управление звонком
  // ═══════════════════════════════════════

  const startCallTimer = () => {
    if (callTimerRef.current) return; // Не запускать повторно
    callTimerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  const handleEndCall = () => {
    if (isCleanedUpRef.current) return;

    console.log('CallScreen v11.0: ЗАВЕРШЕНИЕ ЗВОНКА, callId:', callIdRef.current);

    NotificationService.cancelAllNotifications();

    // [FIX v11.0] Передаём peer и callId — сервер отправит call_ended ТОЛЬКО собеседнику
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
    WebRTCService.cleanup();

    // Release Telecom connection (Freecess immunity no longer needed)
    ConnectionService.endTelecomCall();

    if (isMountedRef.current) {
      setLocalStream(null);
      setRemoteStream(null);
    }
  };

  // ═══════════════════════════════════════
  // Управление медиа
  // ═══════════════════════════════════════

  const toggleMute = () => {
    const newState = !isMuted;
    WebRTCService.toggleMicrophone(!newState);
    setIsMuted(newState);
  };

  const toggleVideo = () => {
    if (!isVideo) return;
    const newState = !isVideoEnabled;
    WebRTCService.toggleCamera(newState);
    setIsVideoEnabled(newState);
  };

  const switchCamera = () => {
    if (!isVideo || !isVideoEnabled) return;
    WebRTCService.switchCamera();
  };

  // ═══════════════════════════════════════
  // Утилиты
  // ═══════════════════════════════════════

  const formatDuration = seconds => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  };

  const getStateText = () => {
    switch (callState) {
      case 'initializing':
        return 'Инициализация...';
      case 'calling':
        return 'Вызов...';
      case 'connecting':
        return 'Соединение...';
      case 'connected':
        return formatDuration(callDuration);
      case 'timeout':
        return 'Нет ответа';
      default:
        return '';
    }
  };

  return (
    <View style={styles.container}>
      {/* StatusBar wrapped - safe even when activity is null */}
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Удалённое видео */}
      {remoteStream && isVideo ? (
        <RTCView
          streamURL={remoteStream.toURL()}
          style={styles.remoteVideo}
          objectFit="cover"
          mirror={false}
        />
      ) : (
        <View style={styles.remoteVideoPlaceholder}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarLargeText}>
              {peer.substring(0, 2).toUpperCase()}
            </Text>
          </View>
        </View>
      )}

      {/* Локальное видео (PiP) */}
      {localStream && isVideo && isVideoEnabled && (
        <View style={styles.localVideoContainer}>
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.localVideo}
            objectFit="cover"
            mirror={true}
          />
        </View>
      )}

      {/* Оверлей */}
      <View style={styles.overlay}>
        {/* Хедер */}
        <View style={styles.header}>
          <Text style={styles.peerName}>{peer}</Text>
          <Text style={styles.callStateText}>{getStateText()}</Text>
        </View>

        {/* Контролы */}
        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.controlButton, isMuted && styles.controlButtonActive]}
            onPress={toggleMute}>
            <Text style={styles.controlIcon}>{isMuted ? '🔇' : '🎤'}</Text>
            <Text style={styles.controlLabel}>Микрофон</Text>
          </TouchableOpacity>

          {isVideo && (
            <TouchableOpacity
              style={[
                styles.controlButton,
                !isVideoEnabled && styles.controlButtonActive,
              ]}
              onPress={toggleVideo}>
              <Text style={styles.controlIcon}>
                {isVideoEnabled ? '📹' : '📵'}
              </Text>
              <Text style={styles.controlLabel}>Видео</Text>
            </TouchableOpacity>
          )}

          {isVideo && isVideoEnabled && (
            <TouchableOpacity
              style={styles.controlButton}
              onPress={switchCamera}>
              <Text style={styles.controlIcon}>🔄</Text>
              <Text style={styles.controlLabel}>Камера</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.controlButton, styles.endCallButton]}
            onPress={handleEndCall}>
            <Text style={styles.controlIcon}>📵</Text>
            <Text style={styles.controlLabel}>Завершить</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  remoteVideo: {
    width: width,
    height: height,
  },
  remoteVideoPlaceholder: {
    flex: 1,
    backgroundColor: '#1a1a1a',
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
  },
  avatarLargeText: {
    fontSize: 60,
    fontWeight: 'bold',
    color: '#fff',
  },
  localVideoContainer: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 120,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
    elevation: 5,
  },
  localVideo: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  peerName: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 3,
  },
  callStateText: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 3,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 50,
    paddingHorizontal: 20,
    flexWrap: 'wrap',
  },
  controlButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 10,
    marginVertical: 5,
  },
  controlButtonActive: {
    backgroundColor: 'rgba(255, 59, 48, 0.8)',
  },
  endCallButton: {
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
  },
  controlIcon: {
    fontSize: 28,
  },
  controlLabel: {
    fontSize: 11,
    color: '#fff',
    marginTop: 4,
    fontWeight: '500',
  },
});