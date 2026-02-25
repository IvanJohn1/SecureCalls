import {NativeModules, Platform} from 'react-native';

const {ConnectionService} = NativeModules;

/**
 * ConnectionServiceHelper - обертка для управления Foreground Service
 * 
 * Позволяет поддерживать соединение активным в фоне для получения входящих звонков
 */
class ConnectionServiceHelper {
  /**
   * Запустить Foreground Service
   * Вызывается при успешном логине
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
      // Не выбрасываем ошибку - приложение должно работать даже без foreground service
      return false;
    }
  }

  /**
   * Остановить Foreground Service
   * Вызывается при logout
   */
  async stop() {
    if (Platform.OS !== 'android') {
      return true;
    }

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
    if (Platform.OS !== 'android') {
      return false;
    }

    try {
      return await ConnectionService.isRunning();
    } catch (error) {
      console.error('[ConnectionService] ❌ Ошибка проверки статуса:', error);
      return false;
    }
  }

  /**
   * Register PhoneAccount with Android Telecom framework.
   * Gives the app Samsung Freecess immunity during incoming calls.
   * Must be called at least once (at login / app start).
   */
  async registerPhoneAccount() {
    if (Platform.OS !== 'android') {
      return true;
    }

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
   * End the active Telecom call connection.
   * Must be called when a call ends to properly release Telecom resources.
   */
  async endTelecomCall() {
    if (Platform.OS !== 'android') {
      return true;
    }

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
