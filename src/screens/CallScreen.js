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
import WebRTCService from '../services/WebRTCService';
import NotificationService from '../services/NotificationService';
import AudioService from '../services/AudioService';

// Dynamic import — react-native-webrtc may not exist on Windows
let RTCView = null;
try {
  RTCView = require('react-native-webrtc').RTCView;
} catch (e) {
  console.warn('[CallScreen] RTCView not available on this platform');
}

const {width, height} = Dimensions.get('window');

/**
 * CallScreen v9.0 — Full VoIP Audio
 *
 * NEW in v9.0:
 * 1. Ringback tone for caller (hears "ringing" while waiting)
 * 2. Speaker toggle
 * 3. Volume control (up/down buttons)
 * 4. MODE_IN_COMMUNICATION for proper VoIP audio routing
 * 5. Max call volume on connect for loud, clear audio
 */

console.log('CallScreen v9.0: Full VoIP Audio');

export default function CallScreen({route, navigation}) {
  const {username, peer, isVideo, isCaller, offer, callId: initialCallId} = route.params;

  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callState, setCallState] = useState('initializing');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(isVideo);
  const [callDuration, setCallDuration] = useState(0);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [volumePercent, setVolumePercent] = useState(100);

  const callTimerRef = useRef(null);
  const callTimeoutRef = useRef(null);
  const answerSentRef = useRef(false);
  const offerSentRef = useRef(false);
  const isMountedRef = useRef(true);
  const isCleanedUpRef = useRef(false);
  const callIdRef = useRef(initialCallId || null);
  const callStateRef = useRef('initializing');

  const updateCallState = (newState) => {
    if (callStateRef.current === 'connected' && newState === 'connecting') {
      return;
    }
    const prevState = callStateRef.current;
    callStateRef.current = newState;
    setCallState(newState);

    // Audio state transitions
    if (newState === 'calling' && isCaller) {
      // Caller: play ringback so they hear "ringing"
      AudioService.startRingback();
    }

    if (newState === 'connecting' && prevState === 'calling') {
      // Call accepted — stop ringback
      AudioService.stopRingback();
    }

    if (newState === 'connected' && prevState !== 'connected') {
      // Call connected — setup VoIP audio
      AudioService.stopRingback();
      AudioService.setCallMode();
      AudioService.setMaxVolume();
      // Read current volume
      AudioService.getVolume().then(v => {
        if (isMountedRef.current) setVolumePercent(v);
      });
    }

    if (newState === 'timeout') {
      AudioService.stopRingback();
    }
  };

  useEffect(() => {
    console.log('CallScreen v9.0: MOUNT');
    console.log('User:', username, 'Peer:', peer, 'Video:', isVideo, 'Caller:', isCaller);

    isMountedRef.current = true;
    isCleanedUpRef.current = false;

    NotificationService.cancelAllNotifications();

    initialize();

    if (isCaller) {
      callTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        console.log('Call timeout (60s)');
        Alert.alert('Нет ответа', 'Собеседник не отвечает', [
          {text: 'OK', onPress: handleEndCall},
        ]);
      }, 60000);
    }

    return () => {
      console.log('CallScreen v9.0: UNMOUNT');
      isMountedRef.current = false;
      cleanup();
    };
  }, []);

  const initialize = async () => {
    try {
      console.log('CallScreen: INIT');

      await WebRTCService.fetchIceServers();
      if (!isMountedRef.current) return;

      const stream = await WebRTCService.getLocalStream(isVideo);
      if (!isMountedRef.current) return;
      setLocalStream(stream);

      WebRTCService.createPeerConnection();

      setupListeners();

      if (isCaller) {
        if (!isMountedRef.current) return;
        updateCallState('calling');
      } else {
        if (!isMountedRef.current) return;
        updateCallState('connecting');

        // Set VoIP audio mode for receiver too
        AudioService.setCallMode();
        AudioService.setMaxVolume();

        if (offer) {
          await new Promise(resolve => setTimeout(resolve, 300));
          if (!isMountedRef.current) return;
          await handleOfferAndSendAnswer(offer);
        }
      }

      console.log('CallScreen: INIT DONE');
    } catch (error) {
      console.error('CallScreen: INIT ERROR:', error.message);
      if (!isMountedRef.current) return;
      Alert.alert('Ошибка инициализации', error.message, [
        {text: 'OK', onPress: () => navigation.goBack()},
      ]);
    }
  };

  // ═══════════════════════════════════════
  // callId handlers
  // ═══════════════════════════════════════

  const handleCallInitiated = data => {
    if (data.to === peer) {
      callIdRef.current = data.callId;
      console.log('CallScreen: callId (call_initiated):', data.callId);
    }
  };

  const handleCallRingingOffline = data => {
    if (data.to === peer || data.callId) {
      callIdRef.current = data.callId;
      console.log('CallScreen: callId (call_ringing_offline):', data.callId);
    }
  };

  const handleCallTimeout = data => {
    if (!isMountedRef.current) return;
    console.log('CallScreen: Timeout from server');
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

  const handleCallAccepted = async data => {
    if (!isMountedRef.current) return;
    if (offerSentRef.current) return;

    console.log('CallScreen: CALL ACCEPTED — creating offer');

    try {
      offerSentRef.current = true;
      if (!isMountedRef.current) return;
      updateCallState('connecting');

      await new Promise(resolve => setTimeout(resolve, 800));
      if (!isMountedRef.current) return;

      const createdOffer = await WebRTCService.createOffer();
      if (!isMountedRef.current) return;

      SocketService.sendWebRTCOffer(peer, createdOffer);
      console.log('Offer sent after call accepted');
    } catch (error) {
      console.error('Error creating offer:', error);
      offerSentRef.current = false;
    }
  };

  const handleOfferAndSendAnswer = async offerData => {
    if (answerSentRef.current) return;

    try {
      console.log('CallScreen: Processing offer -> creating answer');

      const answer = await WebRTCService.createAnswer(offerData);
      if (!isMountedRef.current) return;

      const sent = SocketService.sendWebRTCAnswer(peer, answer);
      if (sent) {
        answerSentRef.current = true;
        console.log('Answer sent');
      } else {
        console.error('Failed to send answer');
      }
    } catch (error) {
      console.error('Error processing offer:', error);
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

  // ═══════════════════════════════════════
  // WebRTC handlers
  // ═══════════════════════════════════════

  const handleRemoteStream = stream => {
    if (!isMountedRef.current) return;
    console.log('CallScreen: REMOTE STREAM received');

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
    console.log('ICE state:', state);

    if (state === 'connected' || state === 'completed') {
      if (callStateRef.current !== 'connected') {
        updateCallState('connected');
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
    console.log('Connection state:', state);

    if (state === 'connecting') {
      if (callStateRef.current !== 'connected') {
        updateCallState('connecting');
      }
    }

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

  // ═══════════════════════════════════════
  // Socket handlers
  // ═══════════════════════════════════════

  const handleOffer = async data => {
    if (data.from !== peer) return;
    if (!isMountedRef.current) return;
    console.log('CallScreen: OFFER received via socket from:', data.from);
    await handleOfferAndSendAnswer(data.offer);
  };

  const handleAnswer = async data => {
    if (data.from !== peer) return;
    if (!isMountedRef.current) return;
    console.log('CallScreen: ANSWER received from:', data.from);

    try {
      await WebRTCService.setRemoteAnswer(data.answer);
      if (isMountedRef.current) {
        updateCallState('connecting');
      }
    } catch (error) {
      console.error('Error processing answer:', error);
    }
  };

  const handleRemoteIceCandidate = async data => {
    if (data.from !== peer) return;
    try {
      await WebRTCService.addIceCandidate(data.candidate);
    } catch (error) {
      console.warn('ICE candidate error:', error.message);
    }
  };

  const handleCallRejected = data => {
    if (!isMountedRef.current) return;
    Alert.alert('Звонок отклонён', 'Собеседник отклонил звонок', [
      {text: 'OK', onPress: () => navigation.goBack()},
    ]);
  };

  const handleCallEnded = data => {
    if (!isMountedRef.current) return;
    cleanup();
    navigation.goBack();
  };

  const handleCallCancelled = data => {
    if (!isMountedRef.current) return;
    cleanup();
    navigation.goBack();
  };

  // ═══════════════════════════════════════
  // Call management
  // ═══════════════════════════════════════

  const startCallTimer = () => {
    if (callTimerRef.current) return;
    callTimerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  const handleEndCall = () => {
    if (isCleanedUpRef.current) return;

    console.log('CallScreen: END CALL, callId:', callIdRef.current);

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

    // Stop all audio
    AudioService.stopRingback();
    AudioService.setNormalMode();
    AudioService.setSpeaker(false);

    cleanupListeners();
    WebRTCService.cleanup();

    if (isMountedRef.current) {
      setLocalStream(null);
      setRemoteStream(null);
    }
  };

  // ═══════════════════════════════════════
  // Media controls
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

  const toggleSpeaker = () => {
    const newState = !isSpeaker;
    AudioService.setSpeaker(newState);
    setIsSpeaker(newState);
  };

  const volumeUp = () => {
    const newVol = Math.min(100, volumePercent + 15);
    AudioService.setVolume(newVol);
    setVolumePercent(newVol);
  };

  const volumeDown = () => {
    const newVol = Math.max(0, volumePercent - 15);
    AudioService.setVolume(newVol);
    setVolumePercent(newVol);
  };

  // ═══════════════════════════════════════
  // Helpers
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

  const isConnected = callState === 'connected';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Remote video */}
      {remoteStream && isVideo && RTCView ? (
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

      {/* Local video (PiP) */}
      {localStream && isVideo && isVideoEnabled && RTCView && (
        <View style={styles.localVideoContainer}>
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.localVideo}
            objectFit="cover"
            mirror={true}
          />
        </View>
      )}

      {/* Overlay */}
      <View style={styles.overlay}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.peerName}>{peer}</Text>
          <Text style={styles.callStateText}>{getStateText()}</Text>
        </View>

        {/* Volume indicator (shown during connected call) */}
        {isConnected && (
          <View style={styles.volumeIndicator}>
            <Text style={styles.volumeText}>
              {isSpeaker ? 'Динамик' : 'Наушник'} {volumePercent}%
            </Text>
          </View>
        )}

        {/* Controls */}
        <View style={styles.controlsContainer}>
          {/* Volume row (shown during call) */}
          {isConnected && (
            <View style={styles.volumeRow}>
              <TouchableOpacity
                style={styles.volumeButton}
                onPress={volumeDown}>
                <Text style={styles.volumeButtonIcon}>-</Text>
              </TouchableOpacity>
              <View style={styles.volumeBarOuter}>
                <View
                  style={[
                    styles.volumeBarInner,
                    {width: `${volumePercent}%`},
                  ]}
                />
              </View>
              <TouchableOpacity
                style={styles.volumeButton}
                onPress={volumeUp}>
                <Text style={styles.volumeButtonIcon}>+</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Main controls row */}
          <View style={styles.controls}>
            <TouchableOpacity
              style={[styles.controlButton, isMuted && styles.controlButtonActive]}
              onPress={toggleMute}>
              <Text style={styles.controlIcon}>{isMuted ? '🔇' : '🎤'}</Text>
              <Text style={styles.controlLabel}>Микрофон</Text>
            </TouchableOpacity>

            {/* Speaker toggle */}
            <TouchableOpacity
              style={[styles.controlButton, isSpeaker && styles.controlButtonSpeaker]}
              onPress={toggleSpeaker}>
              <Text style={styles.controlIcon}>{isSpeaker ? '🔊' : '🔈'}</Text>
              <Text style={styles.controlLabel}>
                {isSpeaker ? 'Динамик' : 'Наушник'}
              </Text>
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
  volumeIndicator: {
    alignItems: 'center',
    marginTop: 10,
  },
  volumeText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  controlsContainer: {
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  volumeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  volumeButtonIcon: {
    fontSize: 22,
    color: '#fff',
    fontWeight: 'bold',
  },
  volumeBarOuter: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 3,
    marginHorizontal: 12,
    overflow: 'hidden',
  },
  volumeBarInner: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 3,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  controlButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 8,
    marginVertical: 5,
  },
  controlButtonActive: {
    backgroundColor: 'rgba(255, 59, 48, 0.8)',
  },
  controlButtonSpeaker: {
    backgroundColor: 'rgba(76, 175, 80, 0.7)',
  },
  endCallButton: {
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
  },
  controlIcon: {
    fontSize: 28,
  },
  controlLabel: {
    fontSize: 10,
    color: '#fff',
    marginTop: 3,
    fontWeight: '500',
  },
});
