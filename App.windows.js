/**
 * ═══════════════════════════════════════════════════════════
 * App.windows.js — Windows App (no Firebase / Notifee)
 * ═══════════════════════════════════════════════════════════
 *
 * Identical navigation structure to the Android App.js,
 * but without any Firebase/Notifee imports or handlers.
 * On Windows desktop the app is always in the foreground,
 * so push notifications are unnecessary — the socket handles
 * all real-time events (calls, messages).
 */

import React, {useEffect, useRef} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createNavigationContainerRef} from '@react-navigation/native';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import CallScreen from './src/screens/CallScreen';
import IncomingCallScreen from './src/screens/IncomingCallScreen';
import ChatScreen from './src/screens/ChatScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AdminPanelScreen from './src/screens/AdminPanelScreen';

// Services
import SocketService from './src/services/SocketService';

const Stack = createNativeStackNavigator();
export const navigationRef = createNavigationContainerRef();

console.log('╔════════════════════════════════════════╗');
console.log('║  APP.JS — WINDOWS (socket-only)        ║');
console.log('╚════════════════════════════════════════╝');

export default function App() {
  const isNavigationReady = useRef(false);

  useEffect(() => {
    console.log('[App Windows] Инициализация — FCM/Notifee пропущены');
    // No Firebase/Notifee initialization on Windows
    // Socket connection handles all real-time events
  }, []);

  return (
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
  );
}
