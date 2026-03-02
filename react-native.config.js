/**
 * react-native.config.js
 *
 * Конфигурация для всех платформ: Android, iOS, Windows.
 *
 * ВАЖНО: блок windows нужен для react-native run-windows и autolink-windows.
 * Но при первом запуске (до init-windows) файла .csproj ещё нет, и
 * @react-native-windows/cli падает с ENOENT при чтении несуществующего файла
 * в projectConfigWindows → configUtils.readProjectFile.
 * Решение: проверяем наличие файла и отдаём null, если его нет.
 * После init-windows файл появляется и полная конфигурация работает.
 */
const fs = require('fs');
const path = require('path');

const csprojPath = path.join(
  __dirname,
  'windows',
  'SecureCallApp',
  'SecureCallApp.csproj',
);
const hasWindowsProject = fs.existsSync(csprojPath);

module.exports = {
  project: {
    android: {
      sourceDir: './android',
    },
    ios: {},
    windows: hasWindowsProject
      ? {
          sourceDir: './windows',
          solutionFile: 'SecureCallApp.sln',
          project: {
            projectFile: 'SecureCallApp\\SecureCallApp.csproj',
          },
        }
      : null,
  },
};
