import React, {useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  StatusBar,
  Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SocketService from '../services/SocketService';
import ConnectionService from '../services/ConnectionService';

/**
 * ═══════════════════════════════════════════════════════════
 * SettingsScreen - НОВЫЙ ЭКРАН
 * ═══════════════════════════════════════════════════════════
 * 
 * Возможности:
 * - Просмотр информации о аккаунте
 * - Удаление своего аккаунта
 * - Настройки уведомлений
 * - Переход в админ-панель (если админ)
 */

export default function SettingsScreen({route, navigation}) {
  const {username, isAdmin} = route.params;
  const [isDeleting, setIsDeleting] = useState(false);

  /**
   * Удалить свой аккаунт
   */
  const handleDeleteAccount = () => {
    Alert.alert(
      '⚠️ Удаление аккаунта',
      'Вы уверены, что хотите удалить свой аккаунт? Это действие нельзя отменить. Все ваши сообщения и данные будут удалены.',
      [
        {text: 'Отмена', style: 'cancel'},
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: confirmDeleteAccount,
        },
      ]
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      '⚠️ Последнее предупреждение',
      'Вы ДЕЙСТВИТЕЛЬНО хотите удалить аккаунт? Восстановить его будет невозможно!',
      [
        {text: 'Отмена', style: 'cancel'},
        {
          text: 'Да, удалить',
          style: 'destructive',
          onPress: executeDeleteAccount,
        },
      ]
    );
  };

  const executeDeleteAccount = async () => {
    setIsDeleting(true);

    try {
      console.log('[Settings] Удаление аккаунта...');

      // Отправить запрос на сервер
      SocketService.deleteMyAccount();

      // Подождать подтверждения
      const timeout = setTimeout(() => {
        console.log('[Settings] ⚠️ Таймаут удаления, выход...');
        performLogout();
      }, 5000);

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
      console.error('[Settings] Ошибка удаления:', error);
      Alert.alert('Ошибка', 'Произошла ошибка при удалении аккаунта');
      setIsDeleting(false);
    }
  };

  const performLogout = async () => {
    try {
      console.log('[Settings] Выход после удаления...');
      
      await ConnectionService.stop();
      await AsyncStorage.clear();
      SocketService.disconnect(true);
      
      Alert.alert(
        'Аккаунт удален',
        'Ваш аккаунт успешно удален',
        [
          {
            text: 'OK',
            onPress: () => navigation.replace('Login'),
          },
        ]
      );
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

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Настройки</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Account Info */}
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

        {/* Admin Panel */}
        {isAdmin && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Администрирование</Text>
            <TouchableOpacity
              style={styles.adminButton}
              onPress={openAdminPanel}>
              <Text style={styles.adminButtonIcon}>👑</Text>
              <Text style={styles.adminButtonText}>Панель администратора</Text>
              <Text style={styles.adminButtonArrow}>→</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Danger Zone */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Опасная зона</Text>
          <TouchableOpacity
            style={styles.dangerButton}
            onPress={handleDeleteAccount}
            disabled={isDeleting}>
            <Text style={styles.dangerButtonIcon}>🗑️</Text>
            <View style={styles.dangerButtonContent}>
              <Text style={styles.dangerButtonTitle}>
                {isDeleting ? 'Удаление...' : 'Удалить аккаунт'}
              </Text>
              <Text style={styles.dangerButtonSubtitle}>
                Это действие нельзя отменить
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* About */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>О приложении</Text>
          <View style={styles.infoCard}>
            <Text style={styles.aboutText}>SecureCall v7.0</Text>
            <Text style={styles.aboutText}>Безопасные звонки и чаты</Text>
            <Text style={styles.aboutText}>call.n8n-auto.space</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#667eea',
    padding: 15,
    paddingTop: 40,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 28,
    color: '#fff',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 10,
  },
  content: {
    flex: 1,
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 16,
    color: '#666',
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  adminBadge: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  adminBadgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  adminButton: {
    backgroundColor: '#FFD700',
    borderRadius: 12,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },
  adminButtonIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  adminButtonText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  adminButtonArrow: {
    fontSize: 24,
    color: '#333',
  },
  dangerButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FF3B30',
  },
  dangerButtonIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  dangerButtonContent: {
    flex: 1,
  },
  dangerButtonTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF3B30',
  },
  dangerButtonSubtitle: {
    fontSize: 14,
    color: '#999',
    marginTop: 2,
  },
  aboutText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginVertical: 4,
  },
});
