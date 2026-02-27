const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration v2.1
 * https://reactnative.dev/docs/metro
 *
 * ИСПРАВЛЕНО v8.0.0:
 * - Добавлен unstable_enablePackageExports: false для подавления предупреждения
 *   "event-target-shim" missing exports (зависимость react-native-webrtc)
 *
 * ИСПРАВЛЕНО v2.1 (Windows build fix):
 * - blockList: исключаем .cxx директории реаниматора и другие временные CMake папки
 *   из наблюдения Metro. Без этого Metro's FallbackWatcher падает с ENOENT,
 *   когда Gradle/CMake создаёт и удаляет временные директории во время нативной сборки.
 *   Симптом: "Error ENOENT: no such file or directory, watch ...CMakeFiles/CMakeTmp..."
 *
 * @type {import('metro-config').MetroConfig}
 */

// Паттерны директорий которые Metro НЕ должен watch'ить
// (временные CMake/NDK артефакты, создаются и удаляются во время gradle сборки)
const BLOCK_LIST_PATTERNS = [
  // React Native Reanimated native build artifacts
  /node_modules[/\\]react-native-reanimated[/\\]android[/\\]\.cxx[/\\].*/,
  /node_modules[/\\]react-native-reanimated[/\\]android[/\\]build[/\\].*/,
  // React Native WebRTC
  /node_modules[/\\]react-native-webrtc[/\\]android[/\\]\.cxx[/\\].*/,
  /node_modules[/\\]react-native-webrtc[/\\]android[/\\]build[/\\].*/,
  // General CMake temp directories
  /CMakeFiles[/\\]CMakeTmp[/\\].*/,
  // Android app build output (Gradle)
  /android[/\\]app[/\\]build[/\\].*/,
  /android[/\\]build[/\\].*/,
  // iOS DerivedData (if building on Mac)
  /ios[/\\]build[/\\].*/,
  // Windows build output
  /windows[/\\]x64[/\\].*/,
  /windows[/\\]ARM64[/\\].*/,
];

const config = {
  resolver: {
    // Подавляет предупреждение "event-target-shim ... not listed in exports"
    unstable_enablePackageExports: false,
    // Support Windows platform file extensions (.windows.js)
    platforms: ['ios', 'android', 'windows'],
    // Исключаем временные нативные билд-артефакты из наблюдения
    blockList: BLOCK_LIST_PATTERNS,
  },
  watchFolders: [
    // Явно указываем только нужные папки (исключает CMake временные папки)
    path.resolve(__dirname, 'src'),
    path.resolve(__dirname, 'android', 'app', 'src'),
  ],
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
  watcher: {
    // Используем встроенные паттерны игнорирования (совместим с watchman и FallbackWatcher)
    watchman: {
      deferStates: ['hg.update'],
    },
    additionalExts: ['cjs', 'mjs'],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
