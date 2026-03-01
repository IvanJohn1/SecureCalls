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
  NativeModules,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SocketService from '../services/SocketService';
import ConnectionService from '../services/ConnectionService';
import {useTheme} from '../theme/ThemeContext';

/**
 * LoginScreen v13.0 — Theme + Android 15 + Xiaomi MIUI Ready
 */

function isXiaomiDevice() {
  if (Platform.OS !== 'android') return false;
  try {
    const {PlatformConstants} = NativeModules;
    if (PlatformConstants) {
      const manufacturer = (PlatformConstants.Manufacturer || '').toLowerCase();
      const brand = (PlatformConstants.Brand || '').toLowerCase();
      return manufacturer.includes('xiaomi') || brand.includes('xiaomi') || brand.includes('redmi') || brand.includes('poco');
    }
  } catch (_) {}
  return false;
}

export default function LoginScreen({navigation}) {
  const {colors, isDark} = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [permissionsGranted, setPermissionsGranted] = useState(false);

  useEffect(() => {
    checkAutoLogin();
  }, []);

  const requestPermissions = async () => {
    if (Platform.OS !== 'android') {
      setPermissionsGranted(true);
      return true;
    }
    try {
      const permissions = [
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ];
      if (Platform.Version >= 33) {
        permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
      const granted = await PermissionsAndroid.requestMultiple(permissions);
      const status = {
        camera: granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED,
        microphone: granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED,
        notifications: Platform.Version >= 33
          ? granted[PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS] === PermissionsAndroid.RESULTS.GRANTED
          : true,
      };
      const allCritical = status.camera && status.microphone && status.notifications;
      if (allCritical) {
        setPermissionsGranted(true);
        if (Platform.Version >= 34) requestFullScreenIntentPermission();
        return true;
      } else {
        showPermissionWarning(status);
        return false;
      }
    } catch (error) {
      console.error('[LoginScreen] Permission error:', error);
      return false;
    }
  };

  const requestFullScreenIntentPermission = async () => {
    if (Platform.Version < 34) return true;
    try {
      const {CallNotificationModule} = NativeModules;
      if (CallNotificationModule && CallNotificationModule.canUseFullScreenIntent) {
        const canUse = await CallNotificationModule.canUseFullScreenIntent();
        if (canUse) return true;
        Alert.alert(
          'Требуется разрешение',
          'Для показа входящих звонков поверх экрана блокировки необходимо разрешение "Полноэкранные уведомления".',
          [
            {text: 'Позже', style: 'cancel'},
            {
              text: 'Открыть настройки',
              onPress: () => {
                if (CallNotificationModule.openFullScreenIntentSettings) {
                  CallNotificationModule.openFullScreenIntentSettings();
                } else {
                  Linking.openSettings();
                }
              },
            },
          ],
        );
        return false;
      }
      return true;
    } catch (_) {
      return true;
    }
  };

  const showPermissionWarning = (status) => {
    const missing = [];
    if (!status.camera) missing.push('Камера');
    if (!status.microphone) missing.push('Микрофон');
    if (!status.notifications) missing.push('Уведомления');
    Alert.alert(
      'Недостающие разрешения',
      `Необходимы: ${missing.join(', ')}`,
      [
        {text: 'Повторить', onPress: () => requestPermissions()},
        {text: 'Продолжить', onPress: () => setPermissionsGranted(true), style: 'cancel'},
      ],
    );
  };

  const checkAndPromptMiuiAutostart = async () => {
    if (!isXiaomiDevice()) return;
    const shown = await AsyncStorage.getItem('miui_autostart_warned');
    if (shown) return;
    Alert.alert(
      'Xiaomi: Требуется настройка',
      'Для получения звонков на Xiaomi:\n\n1. Настройки > Приложения > SecureCall > Автозапуск: ВКЛ\n2. Настройки > Батарея > SecureCall: "Без ограничений"',
      [
        {text: 'Открыть', onPress: () => { Linking.openSettings(); AsyncStorage.setItem('miui_autostart_warned', 'true'); }},
        {text: 'Позже', style: 'cancel', onPress: () => AsyncStorage.setItem('miui_autostart_warned', 'true')},
      ],
    );
  };

  const checkAutoLogin = async () => {
    try {
      await requestPermissions();
      checkAndPromptMiuiAutostart();
      const savedUsername = await AsyncStorage.getItem('username');
      const savedToken = await AsyncStorage.getItem('token');
      if (savedUsername && savedToken) {
        await attemptAutoLogin(savedUsername, savedToken);
      } else {
        setIsCheckingAuth(false);
      }
    } catch (_) {
      setIsCheckingAuth(false);
    }
  };

  const attemptAutoLogin = async (savedUsername, savedToken) => {
    try {
      await SocketService.connect();
      await SocketService.authenticateWithToken(savedUsername, savedToken);
      await ConnectionService.start();
      try {
        const pendingCallStr = await AsyncStorage.getItem('pendingIncomingCall');
        if (pendingCallStr) {
          const pendingCall = JSON.parse(pendingCallStr);
          await AsyncStorage.removeItem('pendingIncomingCall');
          if (pendingCall.from && (Date.now() - pendingCall.timestamp) < 60000) {
            navigation.replace('IncomingCall', {
              from: pendingCall.from,
              isVideo: pendingCall.isVideo === 'true' || pendingCall.isVideo === true,
              username: savedUsername,
              callId: pendingCall.callId || null,
            });
            return;
          }
        }
      } catch (_) {}
      navigation.replace('Home', {username: savedUsername, token: savedToken});
    } catch (_) {
      await AsyncStorage.clear();
      setIsCheckingAuth(false);
    }
  };

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Ошибка', 'Заполните все поля');
      return;
    }
    if (!permissionsGranted) {
      const granted = await requestPermissions();
      if (!granted) {
        Alert.alert('Внимание', 'Без разрешений функциональность ограничена. Продолжить?', [
          {text: 'Отмена', style: 'cancel'},
          {text: 'Продолжить', onPress: () => proceedWithLogin()},
        ]);
        return;
      }
    }
    await proceedWithLogin();
  };

  const proceedWithLogin = async () => {
    setIsLoading(true);
    try {
      await SocketService.connect();
      if (isLogin) {
        await SocketService.login(username, password);
      } else {
        await SocketService.register(username, password);
      }
      const token = await AsyncStorage.getItem('token');
      await ConnectionService.start();
      navigation.replace('Home', {username, token});
    } catch (error) {
      Alert.alert('Ошибка', error.message || 'Произошла ошибка');
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <View style={[st.loadingContainer, {backgroundColor: colors.background}]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[st.loadingText, {color: colors.textSecondary}]}>Проверка авторизации...</Text>
      </View>
    );
  }

  return (
    <View style={[st.container, {backgroundColor: colors.background}]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.headerBg} />

      <View style={[st.header, {backgroundColor: colors.headerBg}]}>
        <Text style={st.title}>SecureCall</Text>
        <Text style={st.subtitle}>Безопасные звонки</Text>
        <Text style={st.version}>v13.0</Text>
      </View>

      {!permissionsGranted && Platform.OS === 'android' && (
        <View style={[st.permissionsBanner, {backgroundColor: isDark ? '#3D3500' : '#FFF3CD', borderBottomColor: isDark ? '#5C5200' : '#FFE69C'}]}>
          <Text style={[st.permissionsText, {color: isDark ? '#FFD700' : '#856404'}]}>
            Разрешения не предоставлены
          </Text>
          <TouchableOpacity
            style={[st.permissionsButton, {backgroundColor: isDark ? '#5C5200' : '#856404'}]}
            onPress={requestPermissions}>
            <Text style={st.permissionsButtonText}>Запросить</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={st.form}>
        <View style={[st.tabs, {backgroundColor: isDark ? colors.card : '#e0e0e0'}]}>
          <TouchableOpacity
            style={[st.tab, isLogin && {backgroundColor: isDark ? colors.inputBg : '#fff'}]}
            onPress={() => setIsLogin(true)}>
            <Text style={[st.tabText, isLogin && {color: colors.primary, fontWeight: '600'}]}>
              Вход
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.tab, !isLogin && {backgroundColor: isDark ? colors.inputBg : '#fff'}]}
            onPress={() => setIsLogin(false)}>
            <Text style={[st.tabText, !isLogin && {color: colors.primary, fontWeight: '600'}]}>
              Регистрация
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={[st.input, {backgroundColor: colors.card, borderColor: colors.border, color: colors.text}]}
          placeholder="Имя пользователя"
          placeholderTextColor={colors.textHint}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          editable={!isLoading}
        />
        <TextInput
          style={[st.input, {backgroundColor: colors.card, borderColor: colors.border, color: colors.text}]}
          placeholder="Пароль"
          placeholderTextColor={colors.textHint}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!isLoading}
        />

        <TouchableOpacity
          style={[st.button, {backgroundColor: colors.primary}, isLoading && {opacity: 0.6}]}
          onPress={handleLogin}
          disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={st.buttonText}>{isLogin ? 'Войти' : 'Зарегистрироваться'}</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={st.footer}>
        <Text style={[st.footerText, {color: colors.textHint}]}>call.n8n-auto.space</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  container: {flex: 1},
  loadingContainer: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  loadingText: {marginTop: 15, fontSize: 16},
  header: {paddingTop: 60, paddingBottom: 40, alignItems: 'center'},
  title: {fontSize: 40, fontWeight: 'bold', color: '#fff'},
  subtitle: {fontSize: 16, color: 'rgba(255,255,255,0.9)', marginTop: 8},
  version: {fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4},
  permissionsBanner: {
    padding: 15, flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', borderBottomWidth: 1,
  },
  permissionsText: {fontSize: 14, flex: 1},
  permissionsButton: {paddingHorizontal: 15, paddingVertical: 8, borderRadius: 5},
  permissionsButtonText: {color: '#fff', fontSize: 14, fontWeight: '600'},
  form: {padding: 30},
  tabs: {flexDirection: 'row', marginBottom: 30, borderRadius: 10, padding: 4},
  tab: {flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 8},
  tabText: {fontSize: 16, color: '#888', fontWeight: '500'},
  input: {
    borderRadius: 10, padding: 15, fontSize: 16, marginBottom: 15,
    borderWidth: 1,
  },
  button: {borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 10},
  buttonText: {color: '#fff', fontSize: 18, fontWeight: '600'},
  footer: {position: 'absolute', bottom: 30, left: 0, right: 0, alignItems: 'center'},
  footerText: {fontSize: 14},
});
