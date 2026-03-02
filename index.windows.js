/**
 * ═══════════════════════════════════════════════════════════
 * index.windows.js — Windows Desktop Entry Point
 * ═══════════════════════════════════════════════════════════
 *
 * Windows-specific entry point that skips:
 * - @react-native-firebase/messaging (not available on Windows)
 * - @notifee/react-native (not available on Windows)
 * - Android HeadlessTask (Android-only)
 *
 * On Windows, real-time events (calls, messages) are delivered
 * exclusively through the Socket.IO connection.
 *
 * Metro resolves this file when bundling with --platform windows.
 */

import {AppRegistry} from 'react-native';
// EXPLICIT import — do NOT rely on Metro .windows.js auto-resolution
import App from './App.windows';
import {name as appName} from './app.json';

console.log('╔════════════════════════════════════════╗');
console.log('║  INDEX.JS WINDOWS — Desktop Entry      ║');
console.log('╚════════════════════════════════════════╝');

// Register the app — no background handlers needed on desktop
AppRegistry.registerComponent(appName, () => App);
