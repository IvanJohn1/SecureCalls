import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  StatusBar,
  PermissionsAndroid,
  Platform,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SocketService from '../services/SocketService';
import ConnectionService from '../services/ConnectionService';

/**
 * ═══════════════════════════════════════════════════════════
 * LoginScreen v11.0 PRODUCTION - ANDROID 15 READY
 * ═══════════════════════════════════════════════════════════
 * 
 * КРИТИЧНЫЕ ИЗМЕНЕНИЯ:
 * 1. ✅ Запрос всех разрешений включая Android 15 специфичные
 * 2. ✅ POST_NOTIFICATIONS для Android 13+
 * 3. ✅ USE_FULL_SCREEN_INTENT для Android 15+
 * 4. ✅ Graceful handling если разрешения не даны
 */

console.log('╔════════════════════════════════════════╗');
console.log('║  LoginScreen v11.0 PRODUCTION         ║');
console.log('╚════════════════════════════════════════╝');

export default function LoginScreen({navigation}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState({
    camera: false,
    microphone: false,
    notifications: false,
    fullScreen: false,
  });

  useEffect(() => {
    checkAutoLogin();
  }, []);

  /**
   * КРИТИЧНО: Запрос всех необходимых разрешений для Android 15
   */
  const requestPermissions = async () => {
    if (Platform.OS !== 'android') {
      setPermissionsGranted(true);
      return true;
    }

    try {
      console.log('[LoginScreen] 🔐 Запрос разрешений для Android', Platform.Version);

      const permissions = [
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ];

      // Android 13+ (API 33+) - POST_NOTIFICATIONS
      if (Platform.Version >= 33) {
        permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        console.log('[LoginScreen] ➕ Добавлен POST_NOTIFICATIONS (Android 13+)');
      }

      // Запросить основные разрешения
      const granted = await PermissionsAndroid.requestMultiple(permissions);

      // Проверить результаты
      const status = {
        camera: granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED,
        microphone: granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED,
        notifications: Platform.Version >= 33 
          ? granted[PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS] === PermissionsAndroid.RESULTS.GRANTED
          : true, // На Android <13 не требуется
        fullScreen: true, // Будет запрошено отдельно если нужно
      };

      setPermissionStatus(status);

      // Проверить критичные разрешения
      const allCriticalGranted = status.camera && status.microphone && status.notifications;

      if (allCriticalGranted) {
        console.log('[LoginScreen] ✅ Все критичные разрешения получены');
        setPermissionsGranted(true);
        
        // Android 15+ (API 35+) - USE_FULL_SCREEN_INTENT
        if (Platform.Version >= 35) {
          requestFullScreenIntentPermission();
        }
        
        return true;
      } else {
        console.log('[LoginScreen] ⚠️ Не все разрешения получены');
        console.log('[LoginScreen] Статус:', status);
        
        showPermissionWarning(status);
        return false;
      }
    } catch (error) {
      console.error('[LoginScreen] ❌ Ошибка запроса разрешений:', error);
      return false;
    }
  };

  /**
   * НОВОЕ: Запрос разрешения USE_FULL_SCREEN_INTENT для Android 15+
   */
  const requestFullScreenIntentPermission = async () => {
    if (Platform.Version < 35) {
      return true;
    }

    console.log('[LoginScreen] 📱 Запрос USE_FULL_SCREEN_INTENT (Android 15+)');

    try {
      // Для Android 15+ нужно вручную открыть настройки
      Alert.alert(
        'Требуется разрешение',
        'Для показа входящих звонков поверх экрана блокировки необходимо предоставить разрешение "Полноэкранные уведомления".\n\nСейчас откроются настройки приложения.',
        [
          {
            text: 'Отмена',
            style: 'cancel',
          },
          {
            text: 'Открыть настройки',
            onPress: () => {
              Linking.openSettings();
            },
          },
        ]
      );
      
      return true;
    } catch (error) {
      console.error('[LoginScreen] ❌ Ошибка запроса USE_FULL_SCREEN_INTENT:', error);
      return false;
    }
  };

  /**
   * Показать предупреждение о недостающих разрешениях
   */
  const showPermissionWarning = (status) => {
    const missing = [];
    
    if (!status.camera) missing.push('Камера');
    if (!status.microphone) missing.push('Микрофон');
    if (!status.notifications) missing.push('Уведомления');

    const message = `Для работы приложения необходимы следующие разрешения:\n\n${missing.join(', ')}\n\nВы сможете использовать только ограниченную функциональность.`;

    Alert.alert(
      'Недостающие разрешения',
      message,
      [
        {
          text: 'Повторить запрос',
          onPress: () => requestPermissions(),
        },
        {
          text: 'Продолжить',
          onPress: () => setPermissionsGranted(true),
          style: 'cancel',
        },
      ]
    );
  };

  /**
   * Проверка автоматического входа
   */
  const checkAutoLogin = async () => {
    try {
      // Запросить разрешения ПЕРВЫМ ДЕЛОМ
      await requestPermissions();

      const savedUsername = await AsyncStorage.getItem('username');
      const savedToken = await AsyncStorage.getItem('token');

      if (savedUsername && savedToken) {
        console.log('[LoginScreen] 🔑 Найдены сохраненные данные');
        await attemptAutoLogin(savedUsername, savedToken);
      } else {
        setIsCheckingAuth(false);
      }
    } catch (error) {
      console.error('[LoginScreen] ❌ Ошибка проверки авторизации:', error);
      setIsCheckingAuth(false);
    }
  };

  /**
   * Попытка автоматического входа
   */
  const attemptAutoLogin = async (savedUsername, savedToken) => {
    try {
      console.log('[LoginScreen] 🔄 Попытка автовхода...');
      
      await SocketService.connect();
      await SocketService.authenticateWithToken(savedUsername, savedToken);

      // Запустить Foreground Service
      await ConnectionService.start();

      console.log('[LoginScreen] ✅ Автовход успешен');
      navigation.replace('Home', {username: savedUsername, token: savedToken});
    } catch (error) {
      console.error('[LoginScreen] ❌ Ошибка авто-входа:', error);
      await AsyncStorage.clear();
      setIsCheckingAuth(false);
    }
  };

  /**
   * Обработка входа/регистрации
   */
  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Ошибка', 'Заполните все поля');
      return;
    }

    // Проверить разрешения перед входом
    if (!permissionsGranted) {
      const granted = await requestPermissions();
      if (!granted) {
        Alert.alert(
          'Внимание',
          'Без необходимых разрешений функциональность приложения будет ограничена. Продолжить?',
          [
            {text: 'Отмена', style: 'cancel'},
            {text: 'Продолжить', onPress: () => proceedWithLogin()},
          ]
        );
        return;
      }
    }

    await proceedWithLogin();
  };

  const proceedWithLogin = async () => {
    setIsLoading(true);

    try {
      console.log('[LoginScreen] 🔐 Подключение к серверу...');
      await SocketService.connect();

      if (isLogin) {
        console.log('[LoginScreen] 🔓 Вход...');
        await SocketService.login(username, password);
      } else {
        console.log('[LoginScreen] 📝 Регистрация...');
        await SocketService.register(username, password);
      }

      const token = await AsyncStorage.getItem('token');

      // Запустить Foreground Service
      console.log('[LoginScreen] 🚀 Запуск Foreground Service...');
      await ConnectionService.start();

      console.log('[LoginScreen] ✅ Успешный вход');
      navigation.replace('Home', {username, token});
    } catch (error) {
      console.error('[LoginScreen] ❌ Ошибка:', error);
      Alert.alert(
        'Ошибка',
        error.message || 'Произошла ошибка',
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#667eea" />
        <Text style={styles.loadingText}>Проверка авторизации...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#667eea" />

      <View style={styles.header}>
        <Text style={styles.title}>SecureCall</Text>
        <Text style={styles.subtitle}>Безопасные звонки</Text>
        <Text style={styles.version}>v11.0 • Android 15 Ready</Text>
      </View>

      {/* Баннер статуса разрешений */}
      {!permissionsGranted && (
        <View style={styles.permissionsBanner}>
          <Text style={styles.permissionsText}>
            ⚠️ Разрешения не полностью предоставлены
          </Text>
          <TouchableOpacity
            style={styles.permissionsButton}
            onPress={requestPermissions}>
            <Text style={styles.permissionsButtonText}>Запросить</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Детальный статус разрешений (для отладки) */}
      {__DEV__ && !permissionsGranted && (
        <View style={styles.debugContainer}>
          <Text style={styles.debugTitle}>Статус разрешений:</Text>
          <Text style={styles.debugText}>
            📷 Камера: {permissionStatus.camera ? '✅' : '❌'}
          </Text>
          <Text style={styles.debugText}>
            🎤 Микрофон: {permissionStatus.microphone ? '✅' : '❌'}
          </Text>
          <Text style={styles.debugText}>
            🔔 Уведомления: {permissionStatus.notifications ? '✅' : '❌'}
          </Text>
          <Text style={styles.debugText}>
            Android версия: {Platform.Version}
          </Text>
        </View>
      )}

      <View style={styles.form}>
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, isLogin && styles.activeTab]}
            onPress={() => setIsLogin(true)}>
            <Text style={[styles.tabText, isLogin && styles.activeTabText]}>
              Вход
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, !isLogin && styles.activeTab]}
            onPress={() => setIsLogin(false)}>
            <Text style={[styles.tabText, !isLogin && styles.activeTabText]}>
              Регистрация
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Имя пользователя"
          placeholderTextColor="#999"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          editable={!isLoading}
        />

        <TextInput
          style={styles.input}
          placeholder="Пароль"
          placeholderTextColor="#999"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!isLoading}
        />

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {isLogin ? 'Войти' : 'Зарегистрироваться'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>call.n8n-auto.space</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#666',
  },
  header: {
    backgroundColor: '#667eea',
    paddingTop: 60,
    paddingBottom: 40,
    alignItems: 'center',
  },
  title: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 8,
  },
  version: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 4,
  },
  permissionsBanner: {
    backgroundColor: '#FFF3CD',
    padding: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#FFE69C',
  },
  permissionsText: {
    fontSize: 14,
    color: '#856404',
    flex: 1,
  },
  permissionsButton: {
    backgroundColor: '#856404',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 5,
  },
  permissionsButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  debugContainer: {
    backgroundColor: '#E8F5E9',
    padding: 15,
    margin: 15,
    borderRadius: 10,
  },
  debugTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2E7D32',
    marginBottom: 8,
  },
  debugText: {
    fontSize: 12,
    color: '#2E7D32',
    marginBottom: 4,
  },
  form: {
    padding: 30,
  },
  tabs: {
    flexDirection: 'row',
    marginBottom: 30,
    backgroundColor: '#e0e0e0',
    borderRadius: 10,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#fff',
  },
  tabText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#667eea',
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  button: {
    backgroundColor: '#667eea',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#999',
  },
});