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
 *   A) Fix WorkletRuntimeDecorator.cpp — two sub-patches:
 *        A1) replace VLA with unique_ptr<jsi::Value[]>
 *        A2) cast args to const jsi::Value* at the call site so Clang 18
 *            selects the non-template call(Runtime&,const Value*,size_t)
 *            overload instead of the variadic template
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
// A) WorkletRuntimeDecorator.cpp — two independent sub-patches
//
//  A1) VLA fix (line 110)
//      Error: [-Werror,-Wvla-cxx-extension]
//      jsi::Value args[argsSize];  →  unique_ptr + jsi::Value* args
//
//  A2) Call-site fix (line 116)
//      After A1 `args` is jsi::Value* (a named lvalue).  Clang 18 overload
//      resolution then selects the variadic template
//        call<jsi::Value*&, unsigned long&>
//      instead of the non-template
//        call(Runtime&, const Value*, size_t)
//      because forwarding references are an exact match for lvalues while
//      `const Value*` needs a qualification conversion.
//      Casting to `const jsi::Value*` turns the argument into a const-pointer
//      rvalue — an exact match for the non-template — so that overload wins.
//
//  The two sub-patches are INDEPENDENT: A2 must run even when A1 is skipped
//  (i.e. after a previous npm install already applied A1).
// ─────────────────────────────────────────────────────────────────────────────
patch(
  'Common/cpp/ReanimatedRuntime/WorkletRuntimeDecorator.cpp',
  'WorkletRuntimeDecorator.cpp (VLA + call-site fix)',
  (src) => {
    let out = src;

    // ── A1: replace VLA with unique_ptr (only if the VLA is still present) ──
    const VLA = 'jsi::Value args[argsSize]; // NOLINT(runtime/arrays)';
    if (out.includes(VLA)) {
      if (!out.includes('#include <memory>')) {
        out = out.replace(/^(#include\s+\S+[^\n]*)$/m, '$1\n#include <memory>');
      }
      // Regex captures indentation so both lines align correctly.
      out = out.replace(
        /^([ \t]*)jsi::Value args\[argsSize\]; \/\/ NOLINT\(runtime\/arrays\)$/m,
        '$1std::unique_ptr<jsi::Value[]> argsStorage(new jsi::Value[argsSize]);\n$1jsi::Value* args = argsStorage.get();'
      );
    }

    // ── A2: fix the call site (always runs independently of A1) ─────────────
    const CALL_BAD  = 'remoteFun.asObject(rt).asFunction(rt).call(rt, args, argsSize);';
    const CALL_GOOD = 'remoteFun.asObject(rt).asFunction(rt).call(rt, static_cast<const jsi::Value*>(args), argsSize);';
    out = out.split(CALL_BAD).join(CALL_GOOD);

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
