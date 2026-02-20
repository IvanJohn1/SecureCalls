#!/usr/bin/env node
/**
 * Postinstall script — SecureCallApp
 *
 * Patches react-native-reanimated 3.6.2 for compatibility with NDK r27 (Clang 18).
 *
 * Clang 18 promoted two warnings to errors under -Werror:
 *   1. -Wvla-cxx-extension  : VLA (variable-length array) in C++ code
 *   2. -Wdeprecated-this-capture : implicit 'this' capture in [=] lambdas
 *
 * Three-layer defence:
 *   A) Fix WorkletRuntimeDecorator.cpp — replace VLA with unique_ptr
 *   B) Fix NativeReanimatedModule.cpp  — add explicit 'this' to lambdas
 *   C) Fix android/build.gradle        — append -Wno-* flags so the build
 *      succeeds even if A/B patterns drift across minor reanimated versions
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const REANIMATED = path.join(__dirname, '..', 'node_modules', 'react-native-reanimated');

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────
function patch(relPath, label, transformFn) {
  const abs = path.join(REANIMATED, relPath);
  if (!fs.existsSync(abs)) {
    console.log(`[postinstall] ${label}: file not found — skip`);
    return;
  }
  const original = fs.readFileSync(abs, 'utf8');
  const updated  = transformFn(original);
  if (updated === original) {
    console.log(`[postinstall] ${label}: already patched — skip`);
  } else {
    fs.writeFileSync(abs, updated, 'utf8');
    console.log(`[postinstall] ${label}: patched ✓`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A) WorkletRuntimeDecorator.cpp — VLA fix
//
//    Error: [-Werror,-Wvla-cxx-extension]
//    Line:  jsi::Value args[argsSize]; // NOLINT(runtime/arrays)
//
//    Fix:   Replace the C VLA with a heap-allocated unique_ptr<jsi::Value[]>.
//           The local pointer `args` keeps the same type (jsi::Value*) so all
//           downstream code that uses args[i] or passes args to functions
//           requiring const jsi::Value* continues to compile unchanged.
// ─────────────────────────────────────────────────────────────────────────────
patch(
  'Common/cpp/ReanimatedRuntime/WorkletRuntimeDecorator.cpp',
  'WorkletRuntimeDecorator.cpp (VLA → unique_ptr)',
  (src) => {
    const VLA = 'jsi::Value args[argsSize]; // NOLINT(runtime/arrays)';
    if (!src.includes(VLA)) return src; // already patched or different version

    // Add <memory> include once (needed for std::unique_ptr).
    let out = src;
    if (!out.includes('#include <memory>')) {
      // Insert right after the first #include line.
      out = out.replace(/^(#include\s+\S+[^\n]*)$/m, '$1\n#include <memory>');
    }

    // Regex captures leading whitespace so both replacement lines align correctly.
    out = out.replace(
      /^([ \t]*)jsi::Value args\[argsSize\]; \/\/ NOLINT\(runtime\/arrays\)$/m,
      '$1std::unique_ptr<jsi::Value[]> argsStorage(new jsi::Value[argsSize]);\n$1jsi::Value* args = argsStorage.get();'
    );

    return out;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// B) NativeReanimatedModule.cpp — implicit 'this' capture fix
//
//    Error: [-Werror,-Wdeprecated-this-capture]
//    Clang 18 disallows implicit capture of 'this' when a lambda uses the
//    capture-default '='.  The fix is to add an explicit ', this' capture.
//
//    Affected lambdas (5 occurrences across 4 patterns):
//      scheduleOnUI([=] {           ×2  →  scheduleOnUI([=, this] {
//      scheduleOnUI([=]() {         ×1  →  scheduleOnUI([=, this]() {
//      [=] { eventHandlerRegistry_  ×1  →  [=, this] { eventHandlerRegistry_
//      [=](int keyboardState        ×1  →  [=, this](int keyboardState
// ─────────────────────────────────────────────────────────────────────────────
patch(
  'Common/cpp/NativeModules/NativeReanimatedModule.cpp',
  'NativeReanimatedModule.cpp (implicit this → explicit this)',
  (src) => {
    // Quick-exit: if none of the unfixed patterns exist, already patched.
    const needsPatch =
      src.includes('scheduleOnUI([=] {')          ||
      src.includes('scheduleOnUI([=]() {')         ||
      src.includes('[=] { eventHandlerRegistry_')  ||
      src.includes('[=](int keyboardState, int height) {');

    if (!needsPatch) return src;

    return src
      // Pattern 1 & 2 — scheduleOnUI([=] {  (two occurrences)
      .split('scheduleOnUI([=] {').join('scheduleOnUI([=, this] {')
      // Pattern 3 — scheduleOnUI([=]() {
      .split('scheduleOnUI([=]() {').join('scheduleOnUI([=, this]() {')
      // Pattern 4 — nested lambda: [=] { eventHandlerRegistry_->unregisterEventHandler(id); }
      .split('[=] { eventHandlerRegistry_').join('[=, this] { eventHandlerRegistry_')
      // Pattern 5 — keyboard listener lambda: [=](int keyboardState, int height) {
      .split('[=](int keyboardState, int height) {').join('[=, this](int keyboardState, int height) {');
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// C) android/build.gradle — append warning-suppression flags to cppFlags
//
//    The reanimated Gradle module passes -Wall -Werror via cppFlags.
//    Adding -Wno-vla-cxx-extension and -Wno-deprecated-this-capture after
//    -Werror disables those specific warnings even when -Werror is active,
//    acting as a safety net in case A/B patterns don't match on this version.
// ─────────────────────────────────────────────────────────────────────────────
patch(
  'android/build.gradle',
  'reanimated android/build.gradle (suppress NDK r27 warnings)',
  (src) => {
    if (src.includes('-Wno-vla-cxx-extension')) return src; // already done

    // The cppFlags string ends with -Werror" (or -Werror followed by more flags).
    // We insert our suppressions right before the closing quote of that string.
    // Pattern handles both  -Werror"  and  -Werror "  (with/without trailing space).
    return src.replace(
      /(-Werror)(")/,
      '$1 -Wno-vla-cxx-extension -Wno-deprecated-this-capture$2'
    );
  }
);

console.log('[postinstall] react-native-reanimated NDK r27 patches complete');
