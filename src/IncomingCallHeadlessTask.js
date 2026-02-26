import {AppRegistry} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SocketService from './services/SocketService';

/**
 * IncomingCallTask — HeadlessJS task при FCM с убитым приложением.
 *
 * ИСПРАВЛЕНО v2.0:
 * ─────────────────────────────────────────────────────────
 * БАГ: AsyncStorage.setItem('pendingIncomingCall') вызывался ПОСЛЕ
 *      await SocketService.connect() и authenticateWithToken().
 *      Если сеть нестабильна или сервер временно недоступен — connect() бросает
 *      ошибку, catch её ловит, и запись в AsyncStorage никогда не происходит.
 *      HomeScreen.checkPendingCallFromStorage() находит пустой AsyncStorage.
 *      Звонок пропущен.
 *
 * ФИКС: Пишем pendingIncomingCall в AsyncStorage ПЕРВЫМ делом, до сети.
 *       Это гарантирует что HomeScreen всегда найдёт данные звонка,
 *       даже если сокет так и не подключился.
 *
 * NOTE О SOCKET PRE-CONNECT:
 *   HeadlessTask и основное приложение — два разных JS-контекста (bundle).
 *   SocketService.connect() здесь НЕ предоставляет готовый сокет основному
 *   приложению — у него свой собственный SocketService singleton.
 *   Реальная польза HeadlessTask: (1) запись pendingIncomingCall в AsyncStorage,
 *   (2) удержание процесса живым пока пользователь открывает приложение.
 *   socketReady в AsyncStorage теперь убран — он вводил в заблуждение.
 * ─────────────────────────────────────────────────────────
 */
const IncomingCallTask = async taskData => {
  const {from, callId, isVideo} = taskData;

  console.log('════════════════════════════════════════');
  console.log('[HeadlessTask] Started for call from:', from);
  console.log('[HeadlessTask] callId:', callId, '| isVideo:', isVideo);
  console.log('════════════════════════════════════════');

  // ─────────────────────────────────────────────────────
  // ШАГ 1: НЕМЕДЛЕННО сохраняем данные звонка в AsyncStorage.
  //
  // Это ПЕРВОЕ действие — до любых сетевых операций.
  // Гарантирует что HomeScreen.checkPendingCallFromStorage() найдёт данные
  // даже если connect() ниже упадёт с ошибкой.
  // ─────────────────────────────────────────────────────
  try {
    await AsyncStorage.setItem(
      'pendingIncomingCall',
      JSON.stringify({
        from,
        callId: callId || null,
        isVideo: isVideo === true || isVideo === 'true',
        timestamp: Date.now(),
      }),
    );
    console.log('[HeadlessTask] ✅ pendingIncomingCall saved to AsyncStorage');
  } catch (storageError) {
    // Критично — без этого HomeScreen не найдёт звонок
    console.error('[HeadlessTask] ❌ FAILED to save pendingIncomingCall:', storageError.message);
    // Не выходим — продолжаем удерживать процесс живым
  }

  // ─────────────────────────────────────────────────────
  // ШАГ 2: Подключаем сокет (в этом JS-контексте).
  //
  // Важно: Этот сокет НЕ передаётся в основное приложение.
  // Польза: удерживаем процесс Android живым пока пользователь
  // нажимает на уведомление, чтобы MainActivity стартовала быстрее.
  // ─────────────────────────────────────────────────────
  try {
    const username = await AsyncStorage.getItem('username');
    const token = await AsyncStorage.getItem('token');

    if (!username || !token) {
      console.log('[HeadlessTask] No credentials — skipping socket connect');
    } else {
      if (!SocketService.isConnected()) {
        console.log('[HeadlessTask] Connecting socket...');
        await SocketService.connect();
      }

      if (SocketService.getConnectionState() !== 'AUTHENTICATED') {
        console.log('[HeadlessTask] Authenticating...');
        await SocketService.authenticateWithToken(username, token);
      }

      console.log('[HeadlessTask] ✅ Socket authenticated in HeadlessTask context');
    }
  } catch (socketError) {
    // Не критично — pendingIncomingCall уже сохранён выше
    console.warn('[HeadlessTask] Socket connect failed (non-critical):', socketError.message);
  }

  // ─────────────────────────────────────────────────────
  // ШАГ 3: Держим процесс живым 28 секунд.
  //
  // HeadlessJS task timeout = 30 секунд.
  // За это время пользователь видит уведомление и нажимает на него.
  // ─────────────────────────────────────────────────────
  console.log('[HeadlessTask] Keeping process alive for 28s...');
  await new Promise(resolve => setTimeout(resolve, 28000));

  // ─────────────────────────────────────────────────────
  // ШАГ 4: Чистим AsyncStorage.
  //
  // Если пользователь открыл приложение — HomeScreen уже прочитал
  // и удалил pendingIncomingCall. Если нет — удаляем устаревшие данные.
  // ─────────────────────────────────────────────────────
  try {
    await AsyncStorage.removeItem('pendingIncomingCall');
    console.log('[HeadlessTask] pendingIncomingCall cleaned up');
  } catch (e) {
    // Игнорируем — уже мог быть удалён HomeScreen
  }

  console.log('[HeadlessTask] Task complete');
};

AppRegistry.registerHeadlessTask('IncomingCallTask', () => IncomingCallTask);