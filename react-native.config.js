/**
 * react-native.config.js
 *
 * Конфигурация для всех платформ: Android, iOS, Windows.
 * ВАЖНО: Этот файл критичен для `react-native run-windows` —
 * без блока `windows` команда не находит .sln файл.
 */
module.exports = {
  project: {
    android: {
      sourceDir: './android',
    },
    ios: {},
    windows: {
      sourceDir: './windows',
      solutionFile: 'SecureCallApp.sln',
      project: {
        projectFile: 'SecureCallApp\\SecureCallApp.csproj',
      },
    },
  },
};
