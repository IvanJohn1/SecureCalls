const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration v2.0
 * https://reactnative.dev/docs/metro
 *
 * ИСПРАВЛЕНО v8.0.0:
 * - Добавлен unstable_enablePackageExports: false для подавления предупреждения
 *   "event-target-shim" missing exports (зависимость react-native-webrtc)
 * - Metro пытается использовать package.json "exports" поле, но event-target-shim
 *   не экспортирует "./index" подпуть. Отключение этой проверки безопасно.
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // Подавляет предупреждение "event-target-shim ... not listed in exports"
    // react-native-webrtc → event-target-shim не имеет корректного exports поля
    unstable_enablePackageExports: false,
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);