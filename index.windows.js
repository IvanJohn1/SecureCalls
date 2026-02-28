/**
 * ═══════════════════════════════════════════════════════════
 * index.windows.js — Windows entry point (no FCM / Notifee)
 * ═══════════════════════════════════════════════════════════
 *
 * On Windows there are no native Firebase or Notifee modules.
 * The standard index.js imports @react-native-firebase/messaging
 * and @notifee/react-native at the top level, which crashes immediately
 * with "Notifee native module not found".
 *
 * This file registers the same App component but skips all
 * Firebase/Notifee setup. Notifications on Windows are handled
 * through the socket connection (the app stays open on desktop).
 *
 * Metro resolves this file automatically when --platform=windows
 * thanks to the .windows.js extension.
 */

import {AppRegistry} from 'react-native';
import App from './App.windows';
import {name as appName} from './app.json';

console.log('╔════════════════════════════════════════╗');
console.log('║  INDEX.JS — WINDOWS (no FCM/Notifee)  ║');
console.log('╚════════════════════════════════════════╝');

AppRegistry.registerComponent(appName, () => App);
