/**
 * ═══════════════════════════════════════════════════════════
 * App.windows.js — Windows Desktop App
 * ═══════════════════════════════════════════════════════════
 *
 * Windows-specific App that skips:
 * - @notifee/react-native (not available on Windows)
 * - @react-native-firebase/messaging (not available on Windows)
 * - Android notification channels
 * - Android permission requests
 *
 * On Windows, incoming calls and messages are handled entirely
 * through Socket.IO events. No FCM push notifications.
 *
 * Metro resolves this file instead of App.js when bundling
 * with --platform windows.
 */

import React, {useEffect, useRef} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createNavigationContainerRef} from '@react-navigation/native';
import {ThemeProvider} from './src/theme/ThemeContext';

// Screens — EXPLICIT .windows imports for screens that depend on native modules
// (react-native-webrtc, @notifee/react-native) unavailable on Windows
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import CallScreen from './src/screens/CallScreen.windows';
import IncomingCallScreen from './src/screens/IncomingCallScreen.windows';
import ChatScreen from './src/screens/ChatScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AdminPanelScreen from './src/screens/AdminPanelScreen';

// Services
import SocketService from './src/services/SocketService';

const Stack = createNativeStackNavigator();
export const navigationRef = createNavigationContainerRef();

console.log('╔════════════════════════════════════════╗');
console.log('║  APP.JS WINDOWS — Desktop              ║');
console.log('╚════════════════════════════════════════╝');

export default function App() {
  const isNavigationReady = useRef(false);

  useEffect(() => {
    console.log('[App Windows] Initialized (no FCM, no Notifee)');
  }, []);

  /**
   * Navigate to IncomingCallScreen using navigationRef.
   * On Windows, incoming calls arrive via Socket.IO events
   * which are handled by HomeScreen.
   */
  const navigateToIncomingCall = (data) => {
    if (!data.from) return;
    if (navigationRef.isReady()) {
      navigationRef.navigate('IncomingCall', {
        from: data.from,
        isVideo: data.isVideo === 'true' || data.isVideo === true,
        username: SocketService.savedUsername || '',
        callId: data.callId || null,
      });
    }
  };

  return (
    <ThemeProvider>
      <NavigationContainer ref={navigationRef} onReady={() => {
        isNavigationReady.current = true;
      }}>
        <Stack.Navigator
          initialRouteName="Login"
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Call" component={CallScreen} />
          <Stack.Screen
            name="IncomingCall"
            component={IncomingCallScreen}
            options={{
              gestureEnabled: false,
              animation: 'fade',
            }}
          />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="AdminPanel" component={AdminPanelScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeProvider>
  );
}
