import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  StatusBar,
  TextInput,
  ActivityIndicator,
  Modal,
} from 'react-native';
import SocketService from '../services/SocketService';

/**
 * ═══════════════════════════════════════════════════════════
 * AdminPanelScreen v2.0 — Android-совместимый бан
 * ═══════════════════════════════════════════════════════════
 *
 * ИСПРАВЛЕНО v2.0:
 * ─────────────────────────────────────────────────────────
 * БАГ: Alert.prompt() — iOS-only API. На Android функция бана
 *      пользователя не работала (нет системного диалога с TextInput).
 *
 * ФИКС: Заменён на кастомный Modal с TextInput — работает на обоих
 *       платформах. Стиль оформления соответствует остальному UI.
 * ─────────────────────────────────────────────────────────
 */

export default function AdminPanelScreen({route, navigation}) {
  const {username: adminUsername} = route.params;
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // [FIX] Состояние для модального окна бана (замена Alert.prompt)
  const [banModal, setBanModal] = useState({visible: false, user: null, reason: 'Нарушение правил'});

  useEffect(() => {
    setupSocketListeners();
    loadUsers();
    return () => cleanupSocketListeners();
  }, []);

  const setupSocketListeners = () => {
    SocketService.on('users_list', handleUsersList);
    SocketService.on('user_deleted', handleUserDeleted);
    SocketService.on('user_banned', handleUserBanned);
    SocketService.on('user_unbanned', handleUserUnbanned);
  };

  const cleanupSocketListeners = () => {
    SocketService.off('users_list', handleUsersList);
    SocketService.off('user_deleted', handleUserDeleted);
    SocketService.off('user_banned', handleUserBanned);
    SocketService.off('user_unbanned', handleUserUnbanned);
  };

  const loadUsers = () => {
    SocketService.getUsers(true);
  };

  const handleUsersList = usersList => {
    setUsers(usersList);
    setIsLoading(false);
  };

  const handleUserDeleted = data => {
    Alert.alert('Успех', `Пользователь ${data.username} удален`);
    loadUsers();
  };

  const handleUserBanned = data => {
    Alert.alert('Успех', `Пользователь ${data.username} забанен`);
    loadUsers();
  };

  const handleUserUnbanned = data => {
    Alert.alert('Успех', `Пользователь ${data.username} разбанен`);
    loadUsers();
  };

  const handleDeleteUser = user => {
    if (user.username === adminUsername) {
      Alert.alert('Ошибка', 'Вы не можете удалить свой аккаунт отсюда. Используйте настройки.');
      return;
    }

    Alert.alert(
      'Удалить пользователя',
      `Вы уверены, что хотите удалить пользователя ${user.username}?`,
      [
        {text: 'Отмена', style: 'cancel'},
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => SocketService.adminDeleteUser(user.username),
        },
      ]
    );
  };

  /**
   * [FIX v2.0] Alert.prompt заменён на Modal с TextInput.
   * Alert.prompt работает только на iOS. На Android показывал пустой Alert
   * или вообще ничего не делал.
   */
  const handleBanUser = user => {
    if (user.username === adminUsername) {
      Alert.alert('Ошибка', 'Вы не можете забанить себя!');
      return;
    }
    setBanModal({visible: true, user, reason: 'Нарушение правил'});
  };

  const confirmBan = () => {
    const {user, reason} = banModal;
    const banReason = reason.trim() || 'Нарушение правил';
    SocketService.adminBanUser(user.username, banReason);
    setBanModal({visible: false, user: null, reason: 'Нарушение правил'});
  };

  const cancelBan = () => {
    setBanModal({visible: false, user: null, reason: 'Нарушение правил'});
  };

  const handleUnbanUser = user => {
    Alert.alert(
      'Разбанить пользователя',
      `Вы уверены, что хотите разбанить ${user.username}?`,
      [
        {text: 'Отмена', style: 'cancel'},
        {text: 'Разбанить', onPress: () => SocketService.adminUnbanUser(user.username)},
      ]
    );
  };

  const renderUser = ({item}) => {
    const isCurrentUser = item.username === adminUsername;
    const isOnline = item.isOnline || item.online;
    const isBanned = item.isBanned || false;

    return (
      <View style={[styles.userCard, isBanned && styles.userCardBanned]}>
        <View style={styles.userInfo}>
          <View style={[styles.avatar, isOnline ? styles.avatarOnline : styles.avatarOffline]}>
            <Text style={styles.avatarText}>{item.username.substring(0, 2).toUpperCase()}</Text>
          </View>
          <View style={styles.userDetails}>
            <View style={styles.userNameRow}>
              <Text style={styles.username}>{item.username}</Text>
              {isCurrentUser && <Text style={styles.currentUserBadge}>Вы</Text>}
              {isBanned && <Text style={styles.bannedBadge}>Забанен</Text>}
            </View>
            <Text style={[styles.status, isOnline ? styles.statusOnline : styles.statusOffline]}>
              {isOnline ? '● В сети' : '○ Не в сети'}
            </Text>
          </View>
        </View>

        {!isCurrentUser && (
          <View style={styles.actions}>
            {isBanned ? (
              <TouchableOpacity style={[styles.actionButton, styles.unbanButton]} onPress={() => handleUnbanUser(item)}>
                <Text style={styles.actionButtonText}>Разбанить</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.actionButton, styles.banButton]} onPress={() => handleBanUser(item)}>
                <Text style={styles.actionButtonText}>Бан</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.actionButton, styles.deleteButton]} onPress={() => handleDeleteUser(item)}>
              <Text style={styles.actionButtonText}>Удалить</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#FFD700" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>👑 Админ-панель</Text>
          <Text style={styles.headerSubtitle}>Управление пользователями</Text>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Поиск пользователя..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{users.length}</Text>
          <Text style={styles.statLabel}>Всего</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{users.filter(u => u.isOnline || u.online).length}</Text>
          <Text style={styles.statLabel}>Онлайн</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{users.filter(u => u.isBanned).length}</Text>
          <Text style={styles.statLabel}>Забанено</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FFD700" />
          <Text style={styles.loadingText}>Загрузка...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredUsers}
          renderItem={renderUser}
          keyExtractor={item => item.username}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>Пользователи не найдены</Text>
            </View>
          }
        />
      )}

      {/* [FIX v2.0] Кастомный Modal для ввода причины бана — Alert.prompt iOS-only */}
      <Modal
        visible={banModal.visible}
        transparent
        animationType="fade"
        onRequestClose={cancelBan}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Бан пользователя</Text>
            <Text style={styles.modalSubtitle}>
              Укажите причину бана для{'\n'}
              <Text style={styles.modalUsername}>{banModal.user?.username}</Text>
            </Text>
            <TextInput
              style={styles.modalInput}
              value={banModal.reason}
              onChangeText={text => setBanModal(prev => ({...prev, reason: text}))}
              placeholder="Причина бана"
              placeholderTextColor="#999"
              autoFocus
              maxLength={200}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalButtonCancel} onPress={cancelBan}>
                <Text style={styles.modalButtonCancelText}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalButtonConfirm} onPress={confirmBan}>
                <Text style={styles.modalButtonConfirmText}>Забанить</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#FFD700', padding: 15, paddingTop: 40, flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  backButtonText: { fontSize: 28, color: '#333' },
  headerContent: { flex: 1, marginLeft: 10 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  headerSubtitle: { fontSize: 14, color: '#666', marginTop: 2 },
  searchContainer: { padding: 15, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e0e0e0' },
  searchInput: { backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 16, color: '#333' },
  statsContainer: { flexDirection: 'row', padding: 15, justifyContent: 'space-around', backgroundColor: '#fff', marginBottom: 10 },
  statCard: { alignItems: 'center' },
  statValue: { fontSize: 32, fontWeight: 'bold', color: '#333' },
  statLabel: { fontSize: 14, color: '#666', marginTop: 4 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 15, fontSize: 16, color: '#666' },
  list: { padding: 15 },
  userCard: { backgroundColor: '#fff', borderRadius: 15, padding: 15, marginBottom: 12, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  userCardBanned: { backgroundColor: '#FFE5E5', borderWidth: 2, borderColor: '#FF3B30' },
  userInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatar: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarOnline: { backgroundColor: '#4CAF50' },
  avatarOffline: { backgroundColor: '#999' },
  avatarText: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  userDetails: { flex: 1 },
  userNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  username: { fontSize: 18, fontWeight: '600', color: '#333', marginRight: 8 },
  currentUserBadge: { backgroundColor: '#FFD700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, fontSize: 12, fontWeight: '600', color: '#333' },
  bannedBadge: { backgroundColor: '#FF3B30', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, fontSize: 12, fontWeight: '600', color: '#fff' },
  status: { fontSize: 14, marginTop: 2 },
  statusOnline: { color: '#4CAF50' },
  statusOffline: { color: '#999' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  actionButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, marginLeft: 8 },
  banButton: { backgroundColor: '#FF9800' },
  unbanButton: { backgroundColor: '#4CAF50' },
  deleteButton: { backgroundColor: '#FF3B30' },
  actionButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 50 },
  emptyText: { fontSize: 18, color: '#999' },
  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30 },
  modalContainer: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%', shadowColor: '#000', shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  modalSubtitle: { fontSize: 15, color: '#666', marginBottom: 16, lineHeight: 22 },
  modalUsername: { fontWeight: 'bold', color: '#FF3B30' },
  modalInput: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10, padding: 12, fontSize: 16, color: '#333', marginBottom: 20, backgroundColor: '#f9f9f9' },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end' },
  modalButtonCancel: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginRight: 10 },
  modalButtonCancelText: { fontSize: 16, color: '#666', fontWeight: '600' },
  modalButtonConfirm: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: '#FF3B30' },
  modalButtonConfirmText: { fontSize: 16, color: '#fff', fontWeight: '600' },
});
