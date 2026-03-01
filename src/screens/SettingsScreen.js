import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  StatusBar,
  Switch,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SocketService from '../services/SocketService';
import ConnectionService from '../services/ConnectionService';
import {useTheme} from '../theme/ThemeContext';

/**
 * SettingsScreen v8.0 — Theme + Volume Controls
 *
 * - Dark/Light theme toggle (Telegram-style)
 * - Microphone volume slider
 * - Speaker volume slider
 * - Account info, delete, admin panel
 */

const VOLUME_MIC_KEY = 'settings_mic_volume';
const VOLUME_SPEAKER_KEY = 'settings_speaker_volume';

export default function SettingsScreen({route, navigation}) {
  const {username, isAdmin} = route.params;
  const {colors, isDark, toggleTheme} = useTheme();
  const [isDeleting, setIsDeleting] = useState(false);
  const [micVolume, setMicVolume] = useState(80);
  const [speakerVolume, setSpeakerVolume] = useState(80);

  useEffect(() => {
    loadVolumeSettings();
  }, []);

  const loadVolumeSettings = async () => {
    try {
      const mic = await AsyncStorage.getItem(VOLUME_MIC_KEY);
      const spk = await AsyncStorage.getItem(VOLUME_SPEAKER_KEY);
      if (mic !== null) setMicVolume(parseInt(mic, 10));
      if (spk !== null) setSpeakerVolume(parseInt(spk, 10));
    } catch (_) {}
  };

  const saveMicVolume = async (val) => {
    setMicVolume(val);
    await AsyncStorage.setItem(VOLUME_MIC_KEY, String(val)).catch(() => {});
  };

  const saveSpeakerVolume = async (val) => {
    setSpeakerVolume(val);
    await AsyncStorage.setItem(VOLUME_SPEAKER_KEY, String(val)).catch(() => {});
  };

  // Simple step buttons since Slider may not be available on all platforms
  const VolumeControl = ({label, icon, value, onChange}) => (
    <View style={[s.volumeCard, {backgroundColor: colors.card}]}>
      <View style={s.volumeHeader}>
        <Text style={[s.volumeIcon]}>{icon}</Text>
        <Text style={[s.volumeLabel, {color: colors.text}]}>{label}</Text>
        <Text style={[s.volumeValue, {color: colors.primary}]}>{value}%</Text>
      </View>
      <View style={s.volumeBarOuter}>
        <View
          style={[
            s.volumeBarInner,
            {width: `${value}%`, backgroundColor: colors.primary},
          ]}
        />
      </View>
      <View style={s.volumeButtons}>
        <TouchableOpacity
          style={[s.volBtn, {backgroundColor: colors.inputBg}]}
          onPress={() => onChange(Math.max(0, value - 10))}>
          <Text style={[s.volBtnText, {color: colors.text}]}>-10</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.volBtn, {backgroundColor: colors.inputBg}]}
          onPress={() => onChange(Math.max(0, value - 5))}>
          <Text style={[s.volBtnText, {color: colors.text}]}>-5</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.volBtn, {backgroundColor: colors.inputBg}]}
          onPress={() => onChange(50)}>
          <Text style={[s.volBtnText, {color: colors.textSecondary}]}>50</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.volBtn, {backgroundColor: colors.inputBg}]}
          onPress={() => onChange(Math.min(100, value + 5))}>
          <Text style={[s.volBtnText, {color: colors.text}]}>+5</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.volBtn, {backgroundColor: colors.inputBg}]}
          onPress={() => onChange(Math.min(100, value + 10))}>
          <Text style={[s.volBtnText, {color: colors.text}]}>+10</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const handleDeleteAccount = () => {
    Alert.alert(
      'Удаление аккаунта',
      'Вы уверены? Это действие нельзя отменить. Все данные будут удалены.',
      [
        {text: 'Отмена', style: 'cancel'},
        {text: 'Удалить', style: 'destructive', onPress: confirmDeleteAccount},
      ],
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      'Последнее предупреждение',
      'Вы ДЕЙСТВИТЕЛЬНО хотите удалить аккаунт? Восстановить его будет невозможно!',
      [
        {text: 'Отмена', style: 'cancel'},
        {text: 'Да, удалить', style: 'destructive', onPress: executeDeleteAccount},
      ],
    );
  };

  const executeDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      SocketService.deleteMyAccount();
      const timeout = setTimeout(() => performLogout(), 5000);
      SocketService.on('account_deleted', () => {
        clearTimeout(timeout);
        performLogout();
      });
      SocketService.on('error', data => {
        clearTimeout(timeout);
        Alert.alert('Ошибка', data.message || 'Не удалось удалить аккаунт');
        setIsDeleting(false);
      });
    } catch (error) {
      Alert.alert('Ошибка', 'Произошла ошибка при удалении аккаунта');
      setIsDeleting(false);
    }
  };

  const performLogout = async () => {
    try {
      await ConnectionService.stop();
      await AsyncStorage.clear();
      SocketService.disconnect(true);
      Alert.alert('Аккаунт удален', 'Ваш аккаунт успешно удален', [
        {text: 'OK', onPress: () => navigation.replace('Login')},
      ]);
    } catch (_) {
      navigation.replace('Login');
    }
  };

  return (
    <View style={[s.container, {backgroundColor: colors.background}]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'light-content'}
        backgroundColor={colors.headerBg}
      />

      {/* Header */}
      <View style={[s.header, {backgroundColor: colors.headerBg}]}>
        <TouchableOpacity style={s.backButton} onPress={() => navigation.goBack()}>
          <Text style={[s.backButtonText, {color: colors.textOnHeader}]}>
            {'<-'}
          </Text>
        </TouchableOpacity>
        <Text style={[s.headerTitle, {color: colors.textOnHeader}]}>Настройки</Text>
      </View>

      <ScrollView style={s.content}>
        {/* Account Info */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, {color: colors.text}]}>Аккаунт</Text>
          <View style={[s.infoCard, {backgroundColor: colors.card}]}>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: colors.textSecondary}]}>
                Имя пользователя:
              </Text>
              <Text style={[s.infoValue, {color: colors.text}]}>{username}</Text>
            </View>
            {isAdmin && (
              <View style={[s.adminBadge, {backgroundColor: colors.adminBadge}]}>
                <Text style={s.adminBadgeText}>Администратор</Text>
              </View>
            )}
          </View>
        </View>

        {/* Theme */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, {color: colors.text}]}>Тема оформления</Text>
          <View style={[s.themeCard, {backgroundColor: colors.card}]}>
            <View style={s.themeRow}>
              <Text style={[s.themeIcon]}>
                {isDark ? '\u{1F319}' : '\u{2600}\u{FE0F}'}
              </Text>
              <View style={s.themeTextContainer}>
                <Text style={[s.themeLabel, {color: colors.text}]}>
                  {isDark ? 'Тёмная тема' : 'Светлая тема'}
                </Text>
                <Text style={[s.themeDescription, {color: colors.textSecondary}]}>
                  {isDark ? 'Telegram-style тёмное оформление' : 'Стандартное светлое оформление'}
                </Text>
              </View>
              <Switch
                value={isDark}
                onValueChange={toggleTheme}
                trackColor={{false: colors.sliderTrack, true: colors.primary}}
                thumbColor={isDark ? '#fff' : '#f4f4f4'}
              />
            </View>
          </View>
        </View>

        {/* Volume Controls */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, {color: colors.text}]}>Громкость звонков</Text>
          <VolumeControl
            label="Микрофон"
            icon={'\u{1F3A4}'}
            value={micVolume}
            onChange={saveMicVolume}
          />
          <View style={{height: 12}} />
          <VolumeControl
            label="Динамик"
            icon={'\u{1F50A}'}
            value={speakerVolume}
            onChange={saveSpeakerVolume}
          />
        </View>

        {/* Admin Panel */}
        {isAdmin && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, {color: colors.text}]}>Администрирование</Text>
            <TouchableOpacity
              style={[s.adminButton, {backgroundColor: colors.adminBadge}]}
              onPress={() => navigation.navigate('AdminPanel', {username})}>
              <Text style={s.adminButtonIcon}>{'\u{1F451}'}</Text>
              <Text style={[s.adminButtonText, {color: '#333'}]}>
                Панель администратора
              </Text>
              <Text style={{fontSize: 24, color: '#333'}}>{'>'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Danger Zone */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, {color: colors.error}]}>Опасная зона</Text>
          <TouchableOpacity
            style={[s.dangerButton, {backgroundColor: colors.card, borderColor: colors.dangerBg}]}
            onPress={handleDeleteAccount}
            disabled={isDeleting}>
            <View style={s.dangerButtonContent}>
              <Text style={[s.dangerButtonTitle, {color: colors.dangerBg}]}>
                {isDeleting ? 'Удаление...' : 'Удалить аккаунт'}
              </Text>
              <Text style={[s.dangerButtonSubtitle, {color: colors.textHint}]}>
                Это действие нельзя отменить
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* About */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, {color: colors.text}]}>О приложении</Text>
          <View style={[s.infoCard, {backgroundColor: colors.card}]}>
            <Text style={[s.aboutText, {color: colors.textSecondary}]}>
              SecureCall v8.0
            </Text>
            <Text style={[s.aboutText, {color: colors.textSecondary}]}>
              Безопасные звонки и чаты
            </Text>
            <Text style={[s.aboutText, {color: colors.textHint}]}>
              call.n8n-auto.space
            </Text>
          </View>
        </View>

        <View style={{height: 40}} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {flex: 1},
  header: {
    padding: 15,
    paddingTop: 40,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {width: 40, height: 40, justifyContent: 'center', alignItems: 'center'},
  backButtonText: {fontSize: 22, fontWeight: 'bold'},
  headerTitle: {fontSize: 24, fontWeight: 'bold', marginLeft: 10},
  content: {flex: 1},
  section: {padding: 20, paddingBottom: 0},
  sectionTitle: {fontSize: 18, fontWeight: '600', marginBottom: 12},
  infoCard: {borderRadius: 12, padding: 15},
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoLabel: {fontSize: 16},
  infoValue: {fontSize: 16, fontWeight: '600'},
  adminBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  adminBadgeText: {fontSize: 14, fontWeight: '600', color: '#333'},
  // Theme card
  themeCard: {borderRadius: 12, padding: 15},
  themeRow: {flexDirection: 'row', alignItems: 'center'},
  themeIcon: {fontSize: 28, marginRight: 12},
  themeTextContainer: {flex: 1},
  themeLabel: {fontSize: 16, fontWeight: '600'},
  themeDescription: {fontSize: 13, marginTop: 2},
  // Volume control
  volumeCard: {borderRadius: 12, padding: 15},
  volumeHeader: {flexDirection: 'row', alignItems: 'center', marginBottom: 10},
  volumeIcon: {fontSize: 22, marginRight: 10},
  volumeLabel: {flex: 1, fontSize: 16, fontWeight: '600'},
  volumeValue: {fontSize: 16, fontWeight: '700'},
  volumeBarOuter: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(128,128,128,0.2)',
    overflow: 'hidden',
    marginBottom: 12,
  },
  volumeBarInner: {height: '100%', borderRadius: 4},
  volumeButtons: {flexDirection: 'row', justifyContent: 'space-between'},
  volBtn: {
    flex: 1,
    marginHorizontal: 3,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  volBtnText: {fontSize: 14, fontWeight: '600'},
  // Admin
  adminButton: {
    borderRadius: 12,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },
  adminButtonIcon: {fontSize: 24, marginRight: 12},
  adminButtonText: {flex: 1, fontSize: 16, fontWeight: '600'},
  // Danger
  dangerButton: {
    borderRadius: 12,
    padding: 15,
    borderWidth: 2,
  },
  dangerButtonContent: {flex: 1},
  dangerButtonTitle: {fontSize: 16, fontWeight: '600'},
  dangerButtonSubtitle: {fontSize: 14, marginTop: 2},
  aboutText: {fontSize: 14, textAlign: 'center', marginVertical: 4},
});
