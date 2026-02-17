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
} from 'react-native';
import SocketService from '../services/SocketService';

/**
 * ═══════════════════════════════════════════════════════════
 * AdminPanelScreen - НОВЫЙ ЭКРАН ДЛЯ АДМИНИСТРАТОРОВ
 * ═══════════════════════════════════════════════════════════
 * 
 * Возможности:
 * - Просмотр всех пользователей
 * - Удаление пользователей
 * - Бан/разбан пользователей
 */

export default function AdminPanelScreen({route, navigation}) {
  const {username: adminUsername} = route.params;
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    console.log('[AdminPanel] Открыта админ-панель');
    
    setupSocketListeners();
    loadUsers();

    return () => {
      cleanupSocketListeners();
    };
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
    console.log('[AdminPanel] Загрузка пользователей...');
    SocketService.getUsers(true);
  };

  const handleUsersList = usersList => {
    console.log('[AdminPanel] Получен список пользователей:', usersList.length);
    setUsers(usersList);
    setIsLoading(false);
  };

  const handleUserDeleted = data => {
    console.log('[AdminPanel] Пользователь удален:', data.username);
    Alert.alert('Успех', `Пользователь ${data.username} удален`);
    loadUsers();
  };

  const handleUserBanned = data => {
    console.log('[AdminPanel] Пользователь забанен:', data.username);
    Alert.alert('Успех', `Пользователь ${data.username} забанен`);
    loadUsers();
  };

  const handleUserUnbanned = data => {
    console.log('[AdminPanel] Пользователь разбанен:', data.username);
    Alert.alert('Успех', `Пользователь ${data.username} разбанен`);
    loadUsers();
  };

  /**
   * Удалить пользователя
   */
  const handleDeleteUser = user => {
    if (user.username === adminUsername) {
      Alert.alert('Ошибка', 'Вы не можете удалить свой аккаунт отсюда. Используйте настройки.');
      return;
    }

    Alert.alert(
      'Удалить пользователя',
      `Вы уверены, что хотите удалить пользователя ${user.username}? Это действие нельзя отменить.`,
      [
        {text: 'Отмена', style: 'cancel'},
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            console.log('[AdminPanel] Удаление пользователя:', user.username);
            SocketService.adminDeleteUser(user.username);
          },
        },
      ]
    );
  };

  /**
   * Забанить пользователя
   */
  const handleBanUser = user => {
    if (user.username === adminUsername) {
      Alert.alert('Ошибка', 'Вы не можете забанить себя!');
      return;
    }

    Alert.prompt(
      'Бан пользователя',
      `Укажите причину бана для ${user.username}:`,
      [
        {text: 'Отмена', style: 'cancel'},
        {
          text: 'Забанить',
          style: 'destructive',
          onPress: reason => {
            const banReason = reason || 'Нарушение правил';
            console.log('[AdminPanel] Бан пользователя:', user.username);
            SocketService.adminBanUser(user.username, banReason);
          },
        },
      ],
      'plain-text',
      'Нарушение правил'
    );
  };

  /**
   * Разбанить пользователя
   */
  const handleUnbanUser = user => {
    Alert.alert(
      'Разбанить пользователя',
      `Вы уверены, что хотите разбанить ${user.username}?`,
      [
        {text: 'Отмена', style: 'cancel'},
        {
          text: 'Разбанить',
          onPress: () => {
            console.log('[AdminPanel] Разбан пользователя:', user.username);
            SocketService.adminUnbanUser(user.username);
          },
        },
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
          <View
            style={[
              styles.avatar,
              isOnline ? styles.avatarOnline : styles.avatarOffline,
            ]}>
            <Text style={styles.avatarText}>
              {item.username.substring(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={styles.userDetails}>
            <View style={styles.userNameRow}>
              <Text style={styles.username}>{item.username}</Text>
              {isCurrentUser && (
                <Text style={styles.currentUserBadge}>Вы</Text>
              )}
              {isBanned && (
                <Text style={styles.bannedBadge}>Забанен</Text>
              )}
            </View>
            <Text
              style={[
                styles.status,
                isOnline ? styles.statusOnline : styles.statusOffline,
              ]}>
              {isOnline ? '● В сети' : '○ Не в сети'}
            </Text>
          </View>
        </View>

        {!isCurrentUser && (
          <View style={styles.actions}>
            {isBanned ? (
              <TouchableOpacity
                style={[styles.actionButton, styles.unbanButton]}
                onPress={() => handleUnbanUser(item)}>
                <Text style={styles.actionButtonText}>Разбанить</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.actionButton, styles.banButton]}
                onPress={() => handleBanUser(item)}>
                <Text style={styles.actionButtonText}>Бан</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionButton, styles.deleteButton]}
              onPress={() => handleDeleteUser(item)}>
              <Text style={styles.actionButtonText}>Удалить</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const filteredUsers = users.filter(user =>
    user.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#FFD700" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>👑 Админ-панель</Text>
          <Text style={styles.headerSubtitle}>
            Управление пользователями
          </Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Поиск пользователя..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{users.length}</Text>
          <Text style={styles.statLabel}>Всего</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {users.filter(u => u.isOnline || u.online).length}
          </Text>
          <Text style={styles.statLabel}>Онлайн</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {users.filter(u => u.isBanned).length}
          </Text>
          <Text style={styles.statLabel}>Забанено</Text>
        </View>
      </View>

      {/* Users List */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#FFD700',
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
    color: '#333',
  },
  headerContent: {
    flex: 1,
    marginLeft: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  searchContainer: {
    padding: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  searchInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: '#333',
  },
  statsContainer: {
    flexDirection: 'row',
    padding: 15,
    justifyContent: 'space-around',
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  statCard: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#666',
  },
  list: {
    padding: 15,
  },
  userCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 15,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  userCardBanned: {
    backgroundColor: '#FFE5E5',
    borderWidth: 2,
    borderColor: '#FF3B30',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarOnline: {
    backgroundColor: '#4CAF50',
  },
  avatarOffline: {
    backgroundColor: '#999',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  userDetails: {
    flex: 1,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  username: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginRight: 8,
  },
  currentUserBadge: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  bannedBadge: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  status: {
    fontSize: 14,
    marginTop: 2,
  },
  statusOnline: {
    color: '#4CAF50',
  },
  statusOffline: {
    color: '#999',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 8,
  },
  banButton: {
    backgroundColor: '#FF9800',
  },
  unbanButton: {
    backgroundColor: '#4CAF50',
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 50,
  },
  emptyText: {
    fontSize: 18,
    color: '#999',
  },
});
