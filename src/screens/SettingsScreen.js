import React, {useState, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  StatusBar,
  // Switch — убран: был импортирован но не использовался
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SocketService from '../services/SocketService';
import ConnectionService from '../services/ConnectionService';

/**
 * ═══════════════════════════════════════════════════════════
 * SettingsScreen v2.0
 * ═══════════════════════════════════════════════════════════
 *
 * ИСПРАВЛЕНО v2.0:
 * ─────────────────────────────────────────────────────────
 * БАГ #1 (МИНОРНЫЙ): Switch был импортирован но не использовался.
 *        Убран из импорта.
 *
 * БАГ #2 (СРЕДНИЙ): executeDeleteAccount() при каждом вызове создавала
 *        новые SocketService.on('account_deleted') и SocketService.on('error')
 *        слушатели без очистки старых. При повторных нажатиях накапливались
 *        зомби-слушатели → несколько вызовов performLogout().
 *        ФИКС: слушатели сохраняются в ref, очищаются перед повторным назначением.
 * ─────────────────────────────────────────────────────────
 */

export default function SettingsScreen({route, navigation}) {
  const {username, isAdmin} = route.params;
  const [isDeleting, setIsDeleting] = useState(false);

  // [FIX #2] Refs для хранения listener callbacks — чтобы правильно их удалять
  const accountDeletedListenerRef = useRef(null);
  const errorListenerRef = useRef(null);
  const deleteTimeoutRef = useRef(null);

  const handleDeleteAccount = () => {
    Alert.alert(
      '⚠️ Удаление аккаунта',
      'Вы уверены, что хотите удалить свой аккаунт? Это действие нельзя отменить.',
      [
        {text: 'Отмена', style: 'cancel'},
        {text: 'Удалить', style: 'destructive', onPress: confirmDeleteAccount},
      ]
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      '⚠️ Последнее предупреждение',
      'Вы ДЕЙСТВИТЕЛЬНО хотите удалить аккаунт?',
      [
        {text: 'Отмена', style: 'cancel'},
        {text: 'Да, удалить', style: 'destructive', onPress: executeDeleteAccount},
      ]
    );
  };

  /**
   * [FIX #2] Очищаем предыдущие слушатели перед добавлением новых.
   * Без этого повторное нажатие "Удалить" создавало дополнительные слушатели,
   * которые потом вызывали performLogout() несколько раз.
   */
  const executeDeleteAccount = async () => {
    if (isDeleting) return; // Защита от двойного нажатия
    setIsDeleting(true);

    console.log('[Settings] Удаление аккаунта...');

    // [FIX #2] Снимаем старые слушатели если есть
    if (accountDeletedListenerRef.current) {
      SocketService.off('account_deleted', accountDeletedListenerRef.current);
      accountDeletedListenerRef.current = null;
    }
    if (errorListenerRef.current) {
      SocketService.off('error', errorListenerRef.current);
      errorListenerRef.current = null;
    }
    if (deleteTimeoutRef.current) {
      clearTimeout(deleteTimeoutRef.current);
      deleteTimeoutRef.current = null;
    }

    // Отправить запрос на сервер
    SocketService.deleteMyAccount();

    // [FIX #2] Сохраняем callbacks в refs для последующей очистки
    const onAccountDeleted = () => {
      clearDeleteListeners();
      performLogout();
    };

    const onError = data => {
      clearDeleteListeners();
      Alert.alert('Ошибка', data.message || 'Не удалось удалить аккаунт');
      setIsDeleting(false);
    };

    accountDeletedListenerRef.current = onAccountDeleted;
    errorListenerRef.current = onError;

    SocketService.on('account_deleted', onAccountDeleted);
    SocketService.on('error', onError);

    // Таймаут 5 сек
    deleteTimeoutRef.current = setTimeout(() => {
      console.log('[Settings] ⚠️ Таймаут удаления, выход...');
      clearDeleteListeners();
      performLogout();
    }, 5000);
  };

  const clearDeleteListeners = () => {
    if (accountDeletedListenerRef.current) {
      SocketService.off('account_deleted', accountDeletedListenerRef.current);
      accountDeletedListenerRef.current = null;
    }
    if (errorListenerRef.current) {
      SocketService.off('error', errorListenerRef.current);
      errorListenerRef.current = null;
    }
    if (deleteTimeoutRef.current) {
      clearTimeout(deleteTimeoutRef.current);
      deleteTimeoutRef.current = null;
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
    } catch (error) {
      console.error('[Settings] Ошибка выхода:', error);
      navigation.replace('Login');
    }
  };

  const openAdminPanel = () => {
    navigation.navigate('AdminPanel', {username});
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#667eea" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Настройки</Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Аккаунт</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Имя пользователя:</Text>
              <Text style={styles.infoValue}>{username}</Text>
            </View>
            {isAdmin && (
              <View style={styles.adminBadge}>
                <Text style={styles.adminBadgeText}>👑 Администратор</Text>
              </View>
            )}
          </View>
        </View>

        {isAdmin && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Администрирование</Text>
            <TouchableOpacity style={styles.adminButton} onPress={openAdminPanel}>
              <Text style={styles.adminButtonIcon}>👑</Text>
              <Text style={styles.adminButtonText}>Панель администратора</Text>
              <Text style={styles.adminButtonArrow}>→</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Опасная зона</Text>
          <TouchableOpacity style={styles.dangerButton} onPress={handleDeleteAccount} disabled={isDeleting}>
            <Text style={styles.dangerButtonIcon}>🗑️</Text>
            <View style={styles.dangerButtonContent}>
              <Text style={styles.dangerButtonTitle}>
                {isDeleting ? 'Удаление...' : 'Удалить аккаунт'}
              </Text>
              <Text style={styles.dangerButtonSubtitle}>Это действие нельзя отменить</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>О приложении</Text>
          <View style={styles.infoCard}>
            <Text style={styles.aboutText}>SecureCall v8.1</Text>
            <Text style={styles.aboutText}>Безопасные звонки и чаты</Text>
            <Text style={styles.aboutText}>call.n8n-auto.space</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#667eea', padding: 15, paddingTop: 40, flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  backButtonText: { fontSize: 28, color: '#fff' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginLeft: 10 },
  content: { flex: 1 },
  section: { padding: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#333', marginBottom: 12 },
  infoCard: { backgroundColor: '#fff', borderRadius: 12, padding: 15 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  infoLabel: { fontSize: 16, color: '#666' },
  infoValue: { fontSize: 16, fontWeight: '600', color: '#333' },
  adminBadge: { backgroundColor: '#FFD700', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, alignSelf: 'flex-start', marginTop: 10 },
  adminBadgeText: { fontSize: 14, fontWeight: '600', color: '#333' },
  adminButton: { backgroundColor: '#FFD700', borderRadius: 12, padding: 15, flexDirection: 'row', alignItems: 'center' },
  adminButtonIcon: { fontSize: 24, marginRight: 12 },
  adminButtonText: { flex: 1, fontSize: 16, fontWeight: '600', color: '#333' },
  adminButtonArrow: { fontSize: 24, color: '#333' },
  dangerButton: { backgroundColor: '#fff', borderRadius: 12, padding: 15, flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: '#FF3B30' },
  dangerButtonIcon: { fontSize: 24, marginRight: 12 },
  dangerButtonContent: { flex: 1 },
  dangerButtonTitle: { fontSize: 16, fontWeight: '600', color: '#FF3B30' },
  dangerButtonSubtitle: { fontSize: 14, color: '#999', marginTop: 2 },
  aboutText: { fontSize: 14, color: '#666', textAlign: 'center', marginVertical: 4 },
});
