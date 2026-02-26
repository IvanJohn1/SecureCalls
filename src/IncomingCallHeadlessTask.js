import {AppRegistry} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SocketService from './services/SocketService';

/**
 * IncomingCallTask — Headless JS Task that runs when FCM delivers
 * an incoming_call push while the app is killed.
 *
 * Purpose:
 *  1. Read saved credentials from AsyncStorage
 *  2. Connect to the Socket.IO server
 *  3. Authenticate with token
 *  4. Save a pendingIncomingCall marker so the UI knows the socket is ready
 *  5. Keep the socket alive for ~28s (just under the 30s task lifetime)
 *
 * When the user taps the notification and MainActivity opens,
 * the socket is already connected and authenticated — acceptCall() works immediately.
 */
const IncomingCallTask = async taskData => {
  const {from, callId, isVideo} = taskData;

  console.log('[HeadlessTask] Started for call from:', from, 'callId:', callId);

  try {
    const username = await AsyncStorage.getItem('username');
    const token = await AsyncStorage.getItem('token');

    if (!username || !token) {
      console.log('[HeadlessTask] No credentials found — task finished');
      return;
    }

    // Connect and authenticate
    if (!SocketService.isConnected()) {
      console.log('[HeadlessTask] Connecting to server...');
      await SocketService.connect();
    }

    if (SocketService.getConnectionState() !== 'AUTHENTICATED') {
      console.log('[HeadlessTask] Authenticating...');
      await SocketService.authenticateWithToken(username, token);
    }

    console.log('[HeadlessTask] Socket ready for call acceptance');

    // Save pending call info so the UI can detect pre-established connection
    await AsyncStorage.setItem(
      'pendingIncomingCall',
      JSON.stringify({
        from,
        callId,
        isVideo,
        socketReady: true,
        timestamp: Date.now(),
      }),
    );

    // Keep the socket alive for 28s (task lifetime is 30s)
    await new Promise(resolve => setTimeout(resolve, 28000));

    // NOTE: Do NOT remove pendingIncomingCall here. LoginScreen will read and
    // clear it after auto-login. The timestamp allows LoginScreen to check
    // freshness (< 30s) and discard stale markers.
  } catch (error) {
    console.error('[HeadlessTask] Error:', error.message);
  }
};

AppRegistry.registerHeadlessTask('IncomingCallTask', () => IncomingCallTask);
