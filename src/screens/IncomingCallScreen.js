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
} from 'react-native';
import SocketService from '../services/SocketService';
import NotificationService from '../services/NotificationService';

const {width} = Dimensions.get('window');

/**
 * IncomingCallScreen v7.0 FIX
 *
 * ИСПРАВЛЕНИЯ:
 * - Слушаем webrtc_offer ДО принятия звонка
 * - Передаём offer в CallScreen через navigation params
 * - Исправлены стили кнопок (accept/reject)
 * - Защита от двойного нажатия
 */

console.log('╔════════════════════════════════════════╗');
console.log('║  IncomingCallScreen v7.0 FIX          ║');
console.log('╚════════════════════════════════════════╝');

export default function IncomingCallScreen({route, navigation}) {
  const {from, isVideo, username} = route.params;

  const [isProcessing, setIsProcessing] = useState(false);
  const [receivedOffer, setReceivedOffer] = useState(null);

  const scaleAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    console.log('═══════════════════════════════════════');
    console.log('IncomingCallScreen v7.0: МОНТИРОВАНИЕ');
    console.log('От:', from);
    console.log('Видео:', isVideo);
    console.log('═══════════════════════════════════════');

    // Анимация появления
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    // Пульсирующая анимация
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

    // КРИТИЧНО: Слушать offer ДО принятия звонка
    SocketService.on('webrtc_offer', handleOffer);
    SocketService.on('call_cancelled', handleCallCancelled);

    // Back button
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        handleReject();
        return true;
      },
    );

    return () => {
      SocketService.off('webrtc_offer', handleOffer);
      SocketService.off('call_cancelled', handleCallCancelled);
      backHandler.remove();
      pulseLoop.stop();
    };
  }, []);

  /**
   * Получить и сохранить offer (может прийти до принятия)
   */
  const handleOffer = data => {
    if (data.from !== from) return;

    console.log('IncomingCallScreen: ПОЛУЧЕН OFFER от:', data.from);
    setReceivedOffer(data.offer);
  };

  const handleCallCancelled = data => {
    if (data.from === from) {
      console.log('✗ Звонок отменён звонящим');
      NotificationService.cancelAllNotifications();
      navigation.goBack();
    }
  };

  /**
   * Принять звонок
   */
  const handleAccept = async () => {
    if (isProcessing) return;

    console.log('═══════════════════════════════════════');
    console.log('IncomingCallScreen: ПРИНЯТИЕ ЗВОНКА');
    console.log('═══════════════════════════════════════');

    setIsProcessing(true);

    try {
      // Отменить уведомления
      await NotificationService.cancelAllNotifications();

      // Отправить accept — сервер уведомит звонящего
      SocketService.acceptCall(from);

      // Перейти на CallScreen с offer (если был получен)
      navigation.replace('Call', {
        username: username,
        peer: from,
        isVideo: isVideo,
        isCaller: false,
        offer: receivedOffer, // ← Передаём offer если был получен до принятия
      });

      console.log('✓ Навигация на CallScreen, offer:', !!receivedOffer);
    } catch (error) {
      console.error('✗ Ошибка принятия:', error);
      setIsProcessing(false);
    }
  };

  /**
   * Отклонить звонок
   */
  const handleReject = async () => {
    if (isProcessing) return;

    console.log('IncomingCallScreen: ОТКЛОНЕНИЕ ЗВОНКА');

    setIsProcessing(true);

    try {
      await NotificationService.cancelAllNotifications();
      SocketService.rejectCall(from);
      navigation.goBack();
    } catch (error) {
      console.error('✗ Ошибка отклонения:', error);
      setIsProcessing(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <View style={styles.content}>
        {/* Аватар с пульсацией */}
        <Animated.View
          style={[
            styles.avatarContainer,
            {
              transform: [{scale: Animated.multiply(scaleAnim, pulseAnim)}],
            },
          ]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {from.substring(0, 2).toUpperCase()}
            </Text>
          </View>
        </Animated.View>

        {/* Имя */}
        <Text style={styles.callerName}>{from}</Text>

        {/* Тип звонка */}
        <Text style={styles.callType}>
          {isVideo ? '📹 Видеозвонок' : '📞 Аудиозвонок'}
        </Text>

        {/* Индикатор offer */}
        {receivedOffer && (
          <View style={styles.offerIndicator}>
            <Text style={styles.offerIndicatorText}>✓ Готов к соединению</Text>
          </View>
        )}
      </View>

      {/* Кнопки */}
      <View style={styles.buttonsContainer}>
        <TouchableOpacity
          style={styles.button}
          onPress={handleReject}
          disabled={isProcessing}
          activeOpacity={0.7}>
          <View style={[styles.buttonIcon, styles.rejectButtonIcon]}>
            <Text style={styles.buttonIconText}>✕</Text>
          </View>
          <Text style={styles.buttonLabel}>
            {isProcessing ? 'Отклонение...' : 'Отклонить'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.button}
          onPress={handleAccept}
          disabled={isProcessing}
          activeOpacity={0.7}>
          <View style={[styles.buttonIcon, styles.acceptButtonIcon]}>
            <Text style={styles.buttonIconText}>✓</Text>
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
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  avatarContainer: {
    marginBottom: 40,
  },
  avatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#667eea',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#667eea',
    shadowOffset: {width: 0, height: 10},
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  avatarText: {
    fontSize: 56,
    fontWeight: 'bold',
    color: '#fff',
  },
  callerName: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
    textAlign: 'center',
  },
  callType: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 20,
  },
  offerIndicator: {
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(76, 175, 80, 0.5)',
    marginTop: 10,
  },
  offerIndicatorText: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '600',
  },
  buttonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 40,
    paddingBottom: 60,
  },
  button: {
    alignItems: 'center',
    minWidth: 100,
  },
  buttonIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  // FIX: Добавлены правильные цвета кнопок
  rejectButtonIcon: {
    backgroundColor: '#F44336',
  },
  acceptButtonIcon: {
    backgroundColor: '#4CAF50',
  },
  buttonIconText: {
    fontSize: 36,
    color: '#fff',
    fontWeight: 'bold',
  },
  buttonLabel: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
});