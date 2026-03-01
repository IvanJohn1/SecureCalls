#!/usr/bin/env node
/**
 * scripts/postinstall.js
 * Патчи нативных модулей после npm install
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ИСТОРИЯ ПРОБЛЕМЫ react-native-safe-area-context                    ║
 * ║                                                                      ║
 * ║  Было: старая версия пакета использовала BaseViewManagerInterface    ║
 * ║  из com.facebook.react.uimanager. Этот класс был УДАЛЁН в RN 0.76.  ║
 * ║  Результат: Java compilation error "cannot find symbol".             ║
 * ║  Kotlin-файл падал отдельно из-за ужесточения type inference 1.9.x. ║
 * ║                                                                      ║
 * ║  Решение: обновить пакеты до версий, совместимых с RN 0.77:         ║
 * ║    react-native-safe-area-context  → ^5.4.0                         ║
 * ║    react-native-gesture-handler    → ^2.22.0                         ║
 * ║                                                                      ║
 * ║  Никакой postinstall-патч не может починить Java-файлы,             ║
 * ║  ссылающиеся на удалённый класс. Только обновление пакета.          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Патч 1: react-native-reanimated — NDK r27 (актуально для старых версий пакета)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const REANIMATED = path.join(__dirname, '..', 'node_modules', 'react-native-reanimated');

// ─────────────────────────────────────────────────────────────────────────────
// Version check: patches only needed for reanimated ≤ 3.8.x (NDK r27 compat)
// Reanimated ≥ 3.16 already includes these fixes upstream.
// ─────────────────────────────────────────────────────────────────────────────
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(REANIMATED, 'package.json'), 'utf8'));
  const major = parseInt(pkg.version.split('.')[0], 10);
  const minor = parseInt(pkg.version.split('.')[1], 10);
  if (major > 3 || (major === 3 && minor >= 16)) {
    console.log(`[postinstall] react-native-reanimated ${pkg.version} — NDK r27 patches not needed (fixed upstream)`);
    process.exit(0);
  }
  console.log(`[postinstall] react-native-reanimated ${pkg.version} — applying NDK r27 patches`);
} catch (e) {
  console.log('[postinstall] react-native-reanimated not found — skip all patches');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────
function patchFile(filePath, patches) {
  if (!fs.existsSync(filePath)) {
    console.log(`[postinstall] ${path.basename(filePath)}: file not found — skip`);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const { description, from, to } of patches) {
    if (content.includes(to)) {
      console.log(`[postinstall] ${description}: already patched — skip`);
      continue;
    }
    if (!content.includes(from)) {
      console.log(`[postinstall] ${description}: pattern not found — skip`);
      continue;
    }
    content = content.split(from).join(to);
    changed = true;
    console.log(`[postinstall] ${description}: ✅ patched`);
  }
  if (changed) fs.writeFileSync(filePath, content, 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. react-native-reanimated NDK r27 patches
// ─────────────────────────────────────────────────────────────────────────────

patchFile(
  path.join(REANIMATED, 'Common/cpp/ReanimatedRuntime/WorkletRuntimeDecorator.cpp'),
  [{ description: 'WorkletRuntimeDecorator.cpp call-site fix',
     from: 'remoteFun.asObject(rt).asFunction(rt).call(rt, args, argsSize);',
     to:   'remoteFun.asObject(rt).asFunction(rt).call(rt, static_cast<const jsi::Value*>(args), argsSize);' }]
);
patchFile(
  path.join(REANIMATED, 'Common/cpp/NativeModules/NativeReanimatedModule.cpp'),
  [
    { description: 'NativeReanimatedModule.cpp scheduleOnUI([=] {',    from: 'scheduleOnUI([=] {',    to: 'scheduleOnUI([=, this] {' },
    { description: 'NativeReanimatedModule.cpp scheduleOnUI([=]() {',  from: 'scheduleOnUI([=]() {',  to: 'scheduleOnUI([=, this]() {' },
    { description: 'NativeReanimatedModule.cpp [=] { eventHandler',    from: '[=] { eventHandlerRegistry_', to: '[=, this] { eventHandlerRegistry_' },
    { description: 'NativeReanimatedModule.cpp [=](int keyboardState', from: '[=](int keyboardState, int height) {', to: '[=, this](int keyboardState, int height) {' },
  ]
);
patchFile(
  path.join(REANIMATED, 'android/build.gradle'),
  [{ description: 'reanimated build.gradle (suppress NDK r27 warnings)',
     from: '-Werror"',
     to:   '-Werror -Wno-vla-cxx-extension -Wno-deprecated-this-capture"' }]
);
console.log('[postinstall] react-native-reanimated NDK r27 patches complete');

// ─────────────────────────────────────────────────────────────────────────────
// 2 & 3. react-native-safe-area-context и react-native-gesture-handler
//
// ✅ ПАТЧИ БОЛЬШЕ НЕ НУЖНЫ — пакеты обновлены до версий для RN 0.77:
//    safe-area-context: ^5.4.0  (удалено использование BaseViewManagerInterface)
//    gesture-handler:   ^2.22.0 (добавлен getViewManagerNames, исправлен type inference)
//
// BaseViewManagerInterface был удалён из React Native в версии 0.76.
// Старые версии пакетов нельзя было починить никакими Kotlin/Java патчами —
// только обновление до совместимых версий решает проблему.
// ─────────────────────────────────────────────────────────────────────────────

console.log('[postinstall] All patches complete ✅');
