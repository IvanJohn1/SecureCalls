import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  BackHandler,
  Animated,
  StatusBar,
  Alert,
} from 'react-native';
import SocketService from '../services/SocketService';
// EXPLICIT .windows import — regular NotificationService.js imports @notifee which crashes on Windows
import NotificationService from '../services/NotificationService.windows';

const {width} = Dimensions.get('window');

/**
 * IncomingCallScreen.windows.js — Windows Desktop
 *
 * Входящий звонок на Windows. UI идентичен мобильному,
 * но при принятии переходит на CallScreen.windows.js
 * (который покажет предупреждение о невозможности WebRTC).
 */

console.log('[IncomingCallScreen.windows.js] LOADED — Windows desktop version');

export default function IncomingCallScreen({route, navigation}) {
  const {from, isVideo, username, callId} = route.params;

  const [isProcessing, setIsProcessing] = useState(false);
  const [receivedOffer, setReceivedOffer] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState(null);

  const isMountedRef = useRef(true);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    pulseLoop.start();

    SocketService.on('webrtc_offer', handleOffer);
    SocketService.on('call_cancelled', handleCallCancelled);
    SocketService.on('call_timeout', handleCallTimeout);

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleReject();
      return true;
    });

    return () => {
      isMountedRef.current = false;
      SocketService.off('webrtc_offer', handleOffer);
      SocketService.off('call_cancelled', handleCallCancelled);
      SocketService.off('call_timeout', handleCallTimeout);
      scaleAnim.stopAnimation();
      pulseAnim.stopAnimation();
    };
  }, []);

  const handleOffer = data => {
    if (data.from !== from) return;
    if (!isMountedRef.current) return;
    setReceivedOffer(data.offer);
  };

  const handleCallCancelled = data => {
    if (!isMountedRef.current) return;
    if (data.from === from) {
      NotificationService.cancelAllNotifications();
      navigation.goBack();
    }
  };

  const handleCallTimeout = data => {
    if (!isMountedRef.current) return;
    if (data.from === from) {
      NotificationService.cancelAllNotifications();
      navigation.goBack();
    }
  };

  const handleAccept = async () => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      await NotificationService.cancelAllNotifications();

      if (!SocketService.isConnected()) {
        setConnectionStatus('Подключение...');
        try {
          await SocketService.waitForAuthentication(12000);
          if (isMountedRef.current) setConnectionStatus(null);
        } catch (e) {
          if (isMountedRef.current) {
            setConnectionStatus('Нет соединения');
            setIsProcessing(false);
          }
          return;
        }
      }

      const accepted = SocketService.acceptCall(from, callId);
      if (!accepted) {
        setConnectionStatus('Ошибка соединения');
        setIsProcessing(false);
        return;
      }

      navigation.replace('Call', {
        username,
        peer: from,
        isVideo,
        isCaller: false,
        offer: receivedOffer,
        callId,
      });
    } catch (error) {
      console.error('Error accepting call:', error);
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await NotificationService.cancelAllNotifications();
      SocketService.rejectCall(from, callId);
      navigation.goBack();
    } catch (error) {
      setIsProcessing(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <View style={styles.content}>
        <Animated.View
          style={[
            styles.avatarContainer,
            {transform: [{scale: Animated.multiply(scaleAnim, pulseAnim)}]},
          ]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {from.substring(0, 2).toUpperCase()}
            </Text>
          </View>
        </Animated.View>

        <Text style={styles.callerName}>{from}</Text>
        <Text style={styles.callType}>
          {isVideo ? 'Видеозвонок' : 'Аудиозвонок'}
        </Text>

        {/* Предупреждение Windows */}
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            Звонки на Windows ограничены
          </Text>
        </View>

        {connectionStatus && (
          <View style={[styles.statusBadge, {borderColor: 'rgba(255,152,0,0.5)', backgroundColor: 'rgba(255,152,0,0.2)'}]}>
            <Text style={[styles.statusBadgeText, {color: '#FF9800'}]}>{connectionStatus}</Text>
          </View>
        )}

        {receivedOffer && !connectionStatus && (
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>Готов к соединению</Text>
          </View>
        )}
      </View>

      <View style={styles.buttonsContainer}>
        <TouchableOpacity
          style={styles.button}
          onPress={handleReject}
          disabled={isProcessing}>
          <View style={[styles.buttonIcon, styles.rejectButtonIcon]}>
            <Text style={styles.buttonIconText}>X</Text>
          </View>
          <Text style={styles.buttonLabel}>
            {isProcessing ? 'Отклонение...' : 'Отклонить'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.button}
          onPress={handleAccept}
          disabled={isProcessing}>
          <View style={[styles.buttonIcon, styles.acceptButtonIcon]}>
            <Text style={styles.buttonIconText}>V</Text>
          </View>
          <Text style={styles.buttonLabel}>
            {isProcessing ? 'Принятие...' : 'Принять'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a1a'},
  content: {flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30},
  avatarContainer: {marginBottom: 40},
  avatar: {
    width: 140, height: 140, borderRadius: 70, backgroundColor: '#667eea',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: {fontSize: 56, fontWeight: 'bold', color: '#fff'},
  callerName: {fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 10, textAlign: 'center'},
  callType: {fontSize: 18, color: 'rgba(255,255,255,0.7)', marginBottom: 15},
  warningBox: {
    backgroundColor: 'rgba(255,152,0,0.15)', borderWidth: 1, borderColor: 'rgba(255,152,0,0.4)',
    borderRadius: 10, paddingHorizontal: 18, paddingVertical: 8, marginBottom: 10,
  },
  warningText: {fontSize: 13, color: '#FFB74D', textAlign: 'center'},
  statusBadge: {
    backgroundColor: 'rgba(76,175,80,0.2)', paddingHorizontal: 20, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(76,175,80,0.5)', marginTop: 10,
  },
  statusBadgeText: {fontSize: 14, color: '#4CAF50', fontWeight: '600'},
  buttonsContainer: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingHorizontal: 40, paddingBottom: 60,
  },
  button: {alignItems: 'center', minWidth: 100},
  buttonIcon: {
    width: 70, height: 70, borderRadius: 35,
    justifyContent: 'center', alignItems: 'center', marginBottom: 10,
  },
  rejectButtonIcon: {backgroundColor: '#F44336'},
  acceptButtonIcon: {backgroundColor: '#4CAF50'},
  buttonIconText: {fontSize: 30, color: '#fff', fontWeight: 'bold'},
  buttonLabel: {fontSize: 16, color: '#fff', fontWeight: '600'},
});
