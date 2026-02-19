/**
 * Postinstall патч для react-native-reanimated 3.6.2 + NDK r27 (Clang 17)
 *
 * NDK r27 использует Clang 17, который с флагом -Werror трактует как ошибки:
 *  - VLA (variable length arrays) в C++  [-Wvla-cxx-extension]
 *  - implicit capture of 'this' с [=]   [-Wdeprecated-this-capture]
 *
 * Этот скрипт добавляет -Wno-error для этих двух предупреждений в CMakeLists.txt
 */

const fs = require('fs');
const path = require('path');

const cmakePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-reanimated',
  'android',
  'CMakeLists.txt'
);

if (!fs.existsSync(cmakePath)) {
  console.log('[postinstall] react-native-reanimated CMakeLists.txt not found, skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(cmakePath, 'utf8');

if (content.includes('-Wno-error=vla-cxx-extension')) {
  console.log('[postinstall] reanimated CMakeLists.txt already patched, skipping');
  process.exit(0);
}

if (!content.includes('-Werror')) {
  console.log('[postinstall] -Werror not found in reanimated CMakeLists.txt, skipping patch');
  process.exit(0);
}

// Добавляем -Wno-error для конкретных предупреждений после -Werror
content = content.replace(
  '-Werror',
  '-Werror -Wno-error=vla-cxx-extension -Wno-error=deprecated-this-capture'
);

fs.writeFileSync(cmakePath, content, 'utf8');
console.log('[postinstall] Patched reanimated CMakeLists.txt: added -Wno-error flags for NDK r27 (Clang 17)');
