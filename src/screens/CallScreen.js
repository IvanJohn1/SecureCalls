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
 * CallScreen v8.1 FIX
 * ═══════════════════════════════════════════════════════════
 *
 * ИСПРАВЛЕНО v8.1:
 * ─────────────────────────────────────────────────────────
 * БАГ: handleEndCall() использовал `callState` (React state) в замыкании.
 *      К моменту вызова `callState` мог быть устаревшим — isCaller
 *      звонящего с callState='calling' вызывал endCall() вместо cancelCall().
 *      ФИКС: используем callStateRef.current (уже объявлен, просто не использовался).
 *
 * ДОБАВЛЕНО v8.1:
 *      После успешного setRemoteAnswer (удалённая сторона ответила) вызываем
 *      ConnectionService.setOutgoingCallActive() → переводит VoIPConnection
 *      в ACTIVE состояние Telecom API. Без этого Freecess immunity не
 *      активировалась для исходящих звонков даже при их регистрации.
 * ─────────────────────────────────────────────────────────
 */

console.log('╔════════════════════════════════════════╗');
console.log('║  CallScreen v8.1 FIX                  ║');
console.log('╚════════════════════════════════════════╝');

export default function CallScreen({route, navigation}) {
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
  const callIdRef = useRef(initialCallId || null);
  const callStateRef = useRef('initializing');

  const updateCallState = (newState) => {
    if (callStateRef.current === 'connected' && newState === 'connecting') return;
    callStateRef.current = newState;
    setCallState(newState);
  };

  useEffect(() => {
    console.log('═══════════════════════════════════════');
    console.log('CallScreen v8.1: МОНТИРОВАНИЕ');
    console.log('Пользователь:', username, '| Собеседник:', peer);
    console.log('Видео:', isVideo, '| Звонящий:', isCaller);
    console.log('═══════════════════════════════════════');

    isMountedRef.current = true;
    isCleanedUpRef.current = false;

    NotificationService.cancelAllNotifications();
    initialize();

    if (isCaller) {
      callTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        Alert.alert('Нет ответа', 'Собеседник не отвечает', [
          {text: 'OK', onPress: handleEndCall},
        ]);
      }, 60000);
    }

    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, []);

  const initialize = async () => {
    try {
      await WebRTCService.fetchIceServers();
      if (!isMountedRef.current) return;

      const stream = await WebRTCService.getLocalStream(isVideo);
      if (!isMountedRef.current) return;
      setLocalStream(stream);

      WebRTCService.createPeerConnection();
      setupListeners();

      if (isCaller) {
        updateCallState('calling');
      } else {
        updateCallState('connecting');
        if (offer) {
          await new Promise(r => setTimeout(r, 300));
          if (!isMountedRef.current) return;
          await handleOfferAndSendAnswer(offer);
        }
      }
    } catch (error) {
      console.error('CallScreen v8.1: ОШИБКА ИНИЦИАЛИЗАЦИИ:', error.message);
      if (!isMountedRef.current) return;
      Alert.alert('Ошибка инициализации', error.message, [
        {text: 'OK', onPress: () => navigation.goBack()},
      ]);
    }
  };

  const handleCallInitiated = data => {
    if (data.to === peer) {
      callIdRef.current = data.callId;
      console.log('CallScreen: callId получен (call_initiated):', data.callId);
    }
  };

  const handleCallRingingOffline = data => {
    if (data.to === peer || data.callId) {
      callIdRef.current = data.callId;
      console.log('CallScreen: callId получен (call_ringing_offline):', data.callId);
    }
  };

  const handleCallTimeout = () => {
    if (!isMountedRef.current) return;
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

  const handleCallAccepted = async () => {
    if (!isMountedRef.current) return;
    if (offerSentRef.current) return;

    console.log('CallScreen v8.1: ЗВОНОК ПРИНЯТ — СОЗДАЁМ OFFER');

    try {
      offerSentRef.current = true;
      updateCallState('connecting');

      await new Promise(r => setTimeout(r, 800));
      if (!isMountedRef.current) return;

      const createdOffer = await WebRTCService.createOffer();
      if (!isMountedRef.current) return;

      SocketService.sendWebRTCOffer(peer, createdOffer);
    } catch (error) {
      console.error('✗ Ошибка создания offer:', error);
      offerSentRef.current = false;
    }
  };

  const handleOfferAndSendAnswer = async offerData => {
    if (answerSentRef.current) return;

    try {
      const answer = await WebRTCService.createAnswer(offerData);
      if (!isMountedRef.current) return;

      const sent = SocketService.sendWebRTCAnswer(peer, answer);
      if (sent) {
        answerSentRef.current = true;
        console.log('✓ Answer успешно отправлен');
      }
    } catch (error) {
      console.error('✗ Ошибка обработки offer:', error);
    }
  };

  const setupListeners = () => {
    WebRTCService.on('remoteStream', handleRemoteStream);
    WebRTCService.on('iceCandidate', handleLocalIceCandidate);
    WebRTCService.on('iceConnectionStateChange', handleIceStateChange);
    WebRTCService.on('connectionStateChange', handleConnectionStateChange);

    SocketService.on('call_accepted', handleCallAccepted);
    SocketService.on('webrtc_offer', handleOffer);
    SocketService.on('webrtc_answer', handleAnswer);
    SocketService.on('ice_candidate', handleRemoteIceCandidate);
    SocketService.on('call_rejected', handleCallRejected);
    SocketService.on('call_ended', handleCallEnded);
    SocketService.on('call_cancelled', handleCallCancelled);
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

  const handleRemoteStream = stream => {
    if (!isMountedRef.current) return;
    setRemoteStream(stream);
    updateCallState('connected');
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    startCallTimer();
  };

  const handleLocalIceCandidate = candidate => {
    SocketService.sendIceCandidate(peer, candidate);
  };

  const handleIceStateChange = state => {
    if (!isMountedRef.current) return;
    console.log('→ ICE состояние:', state);

    if ((state === 'connected' || state === 'completed') && callStateRef.current !== 'connected') {
      updateCallState('connected');
      if (callTimeoutRef.current) {
        clearTimeout(callTimeoutRef.current);
        callTimeoutRef.current = null;
      }
      startCallTimer();
    }
  };

  const handleConnectionStateChange = state => {
    if (!isMountedRef.current) return;
    console.log('→ Connection состояние:', state);

    if (state === 'connected' && callStateRef.current !== 'connected') {
      updateCallState('connected');
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

  const handleOffer = async data => {
    if (data.from !== peer || !isMountedRef.current) return;
    await handleOfferAndSendAnswer(data.offer);
  };

  const handleAnswer = async data => {
    if (data.from !== peer || !isMountedRef.current) return;

    try {
      await WebRTCService.setRemoteAnswer(data.answer);

      // [NEW v8.1] Удалённая сторона ответила — переводим VoIPConnection в ACTIVE.
      // Без этого Telecom считает соединение не установленным и не даёт Freecess immunity.
      if (isCaller) {
        ConnectionService.setOutgoingCallActive().catch(e =>
          console.warn('[CallScreen] setOutgoingCallActive error:', e.message)
        );
      }

      if (isMountedRef.current) updateCallState('connecting');
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

  const startCallTimer = () => {
    if (callTimerRef.current) return;
    callTimerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
  };

  /**
   * [FIX v8.1] Используем callStateRef.current вместо callState.
   * callState в замыкании — устаревшее значение из момента создания функции.
   * callStateRef.current — всегда актуальное значение.
   */
  const handleEndCall = () => {
    if (isCleanedUpRef.current) return;

    console.log('CallScreen v8.1: ЗАВЕРШЕНИЕ ЗВОНКА, callId:', callIdRef.current);
    console.log('CallScreen v8.1: callState:', callStateRef.current);

    NotificationService.cancelAllNotifications();

    // [FIX] callStateRef.current вместо callState (stale closure)
    if (isCaller && callStateRef.current === 'calling') {
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

    if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
    if (callTimeoutRef.current) { clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null; }

    cleanupListeners();
    WebRTCService.cleanup();
    ConnectionService.endTelecomCall();

    if (isMountedRef.current) {
      setLocalStream(null);
      setRemoteStream(null);
    }
  };

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

  const formatDuration = seconds => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
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

      {remoteStream && isVideo ? (
        <RTCView streamURL={remoteStream.toURL()} style={styles.remoteVideo} objectFit="cover" mirror={false} />
      ) : (
        <View style={styles.remoteVideoPlaceholder}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarLargeText}>{peer.substring(0, 2).toUpperCase()}</Text>
          </View>
        </View>
      )}

      {localStream && isVideo && isVideoEnabled && (
        <View style={styles.localVideoContainer}>
          <RTCView streamURL={localStream.toURL()} style={styles.localVideo} objectFit="cover" mirror={true} />
        </View>
      )}

      <View style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.peerName}>{peer}</Text>
          <Text style={styles.callStateText}>{getStateText()}</Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity style={[styles.controlButton, isMuted && styles.controlButtonActive]} onPress={toggleMute}>
            <Text style={styles.controlIcon}>{isMuted ? '🔇' : '🎤'}</Text>
            <Text style={styles.controlLabel}>Микрофон</Text>
          </TouchableOpacity>

          {isVideo && (
            <TouchableOpacity style={[styles.controlButton, !isVideoEnabled && styles.controlButtonActive]} onPress={toggleVideo}>
              <Text style={styles.controlIcon}>{isVideoEnabled ? '📹' : '📵'}</Text>
              <Text style={styles.controlLabel}>Видео</Text>
            </TouchableOpacity>
          )}

          {isVideo && isVideoEnabled && (
            <TouchableOpacity style={styles.controlButton} onPress={switchCamera}>
              <Text style={styles.controlIcon}>🔄</Text>
              <Text style={styles.controlLabel}>Камера</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[styles.controlButton, styles.endCallButton]} onPress={handleEndCall}>
            <Text style={styles.controlIcon}>📵</Text>
            <Text style={styles.controlLabel}>Завершить</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  remoteVideo: { width, height },
  remoteVideoPlaceholder: { flex: 1, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  avatarLarge: { width: 150, height: 150, borderRadius: 75, backgroundColor: '#667eea', justifyContent: 'center', alignItems: 'center' },
  avatarLargeText: { fontSize: 60, fontWeight: 'bold', color: '#fff' },
  localVideoContainer: { position: 'absolute', top: 60, right: 20, width: 120, height: 160, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: '#fff', elevation: 5 },
  localVideo: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between' },
  header: { paddingTop: 60, paddingHorizontal: 20, alignItems: 'center' },
  peerName: { fontSize: 32, fontWeight: 'bold', color: '#fff', textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: {width: 0, height: 1}, textShadowRadius: 3 },
  callStateText: { fontSize: 18, color: 'rgba(255,255,255,0.9)', marginTop: 8, textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: {width: 0, height: 1}, textShadowRadius: 3 },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingBottom: 50, paddingHorizontal: 20, flexWrap: 'wrap' },
  controlButton: { width: 70, height: 70, borderRadius: 35, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginHorizontal: 10, marginVertical: 5 },
  controlButtonActive: { backgroundColor: 'rgba(255,59,48,0.8)' },
  endCallButton: { backgroundColor: 'rgba(255,59,48,0.9)' },
  controlIcon: { fontSize: 28 },
  controlLabel: { fontSize: 11, color: '#fff', marginTop: 4, fontWeight: '500' },
});
