import {NativeModules, Platform} from 'react-native';

const {ConnectionService} = NativeModules;

/**
 * ConnectionServiceHelper - обёртка для управления Foreground Service и Telecom API
 *
 * ДОБАВЛЕНО v2.0:
 * ─────────────────────────────────────────────────────────
 * placeCall(peer, isVideo) — регистрирует ИСХОДЯЩИЙ звонок через
 *   TelecomManager.placeCall() → VoIPConnectionService.onCreateOutgoingConnection().
 *   Даёт процессу Freecess immunity на время исходящего звонка.
 *   Вызывается из HomeScreen.makeCall() ПЕРЕД navigate('Call').
 *
 * setOutgoingCallActive() — переводит исходящий VoIPConnection в ACTIVE.
 *   Вызывается из CallScreen когда удалённая сторона ответила (handleAnswer).
 * ─────────────────────────────────────────────────────────
 */
class ConnectionServiceHelper {
  /**
   * Запустить Foreground Service
   */
  async start() {
    if (Platform.OS !== 'android') {
      console.log('[ConnectionService] iOS не требует foreground service');
      return true;
    }

    try {
      console.log('[ConnectionService] 🚀 Запуск Foreground Service');
      const result = await ConnectionService.start();
      console.log('[ConnectionService] ✅ Foreground Service запущен');
      return result;
    } catch (error) {
      console.error('[ConnectionService] ❌ Ошибка запуска:', error);
      return false;
    }
  }

  /**
   * Остановить Foreground Service
   */
  async stop() {
    if (Platform.OS !== 'android') return true;

    try {
      console.log('[ConnectionService] ⏹️ Остановка Foreground Service');
      const result = await ConnectionService.stop();
      console.log('[ConnectionService] ✅ Foreground Service остановлен');
      return result;
    } catch (error) {
      console.error('[ConnectionService] ❌ Ошибка остановки:', error);
      return false;
    }
  }

  /**
   * Проверить, запущен ли сервис
   */
  async isRunning() {
    if (Platform.OS !== 'android') return false;

    try {
      return await ConnectionService.isRunning();
    } catch (error) {
      console.error('[ConnectionService] ❌ Ошибка проверки статуса:', error);
      return false;
    }
  }

  /**
   * Register PhoneAccount with Android Telecom framework.
   * Gives the app Samsung Freecess immunity during calls.
   */
  async registerPhoneAccount() {
    if (Platform.OS !== 'android') return true;

    try {
      const result = await ConnectionService.registerPhoneAccount();
      console.log('[ConnectionService] PhoneAccount registered:', result);
      return result;
    } catch (error) {
      console.error('[ConnectionService] registerPhoneAccount error:', error);
      return false;
    }
  }

  /**
   * [NEW v2.0] Зарегистрировать ИСХОДЯЩИЙ звонок через Android Telecom API.
   *
   * Вызывается из HomeScreen.makeCall() ПЕРЕД navigate('Call').
   *
   * Цепочка:
   *   JS placeCall() → ConnectionServiceModule.placeCall()
   *   → TelecomHelper.placeOutgoingCall()
   *   → TelecomManager.placeCall()
   *   → VoIPConnectionService.onCreateOutgoingConnection()
   *   → VoIPConnection(state=DIALING)
   *   → Freecess immunity активна
   *
   * @param {string} peer - имя пользователя которому звоним
   * @param {boolean} isVideo - видеозвонок или аудио
   * @returns {Promise<boolean>} - true если Telecom зарегистрировал успешно
   */
  async placeCall(peer, isVideo) {
    if (Platform.OS !== 'android') {
      // iOS: звонить напрямую через SocketService (нет Telecom API)
      return false;
    }

    try {
      console.log('[ConnectionService] 📞 placeCall:', peer, 'video:', isVideo);
      const result = await ConnectionService.placeCall(peer, !!isVideo);
      console.log('[ConnectionService] ✅ Telecom placeCall registered');
      return result;
    } catch (error) {
      console.error('[ConnectionService] ❌ placeCall error:', error);
      return false;
    }
  }

  /**
   * [NEW v2.0] Перевести исходящий VoIPConnection в состояние ACTIVE.
   *
   * Вызывается из CallScreen когда удалённая сторона ответила
   * (при получении webrtc_answer и успешном setRemoteDescription).
   *
   * @returns {Promise<boolean>}
   */
  async setOutgoingCallActive() {
    if (Platform.OS !== 'android') return true;

    try {
      const result = await ConnectionService.setOutgoingCallActive();
      console.log('[ConnectionService] ✅ Outgoing call → ACTIVE');
      return result;
    } catch (error) {
      console.error('[ConnectionService] ❌ setOutgoingCallActive error:', error);
      return false;
    }
  }

  /**
   * End the active Telecom call connection.
   * Called when a call ends (any side).
   */
  async endTelecomCall() {
    if (Platform.OS !== 'android') return true;

    try {
      const result = await ConnectionService.endTelecomCall();
      console.log('[ConnectionService] Telecom call ended');
      return result;
    } catch (error) {
      console.error('[ConnectionService] endTelecomCall error:', error);
      return false;
    }
  }
}

export default new ConnectionServiceHelper();
