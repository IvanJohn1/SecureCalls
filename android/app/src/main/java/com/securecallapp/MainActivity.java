package com.securecallapp;

import com.facebook.react.ReactActivity;
import com.facebook.react.ReactActivityDelegate;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactActivityDelegate;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import android.os.Bundle;
import android.os.Build;
import android.view.WindowManager;
import android.content.Intent;
import android.util.Log;

/**
 * MainActivity v5.0 FIX
 *
 * ИСПРАВЛЕНИЯ:
 * - super.onCreate(null) для предотвращения крашей react-native-screens
 * - Безопасный доступ к ReactContext с задержкой
 * - Правильная обработка pending calls
 * - Совместимость с Android 15
 */
public class MainActivity extends ReactActivity {
    private static final String TAG = "MainActivity";

    // Хранение данных pending call
    private String pendingCallFrom = null;
    private boolean pendingCallIsVideo = false;
    private boolean hasPendingCall = false;

    @Override
    protected String getMainComponentName() {
        return "SecureCallApp";
    }

    @Override
    protected ReactActivityDelegate createReactActivityDelegate() {
        return new DefaultReactActivityDelegate(
                this,
                getMainComponentName(),
                DefaultNewArchitectureEntryPoint.getFabricEnabled()
        );
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        Log.d(TAG, "========================================");
        Log.d(TAG, "📱 onCreate вызван");
        Log.d(TAG, "========================================");

        // ВАЖНО: передаём null для предотвращения крашей react-native-screens
        super.onCreate(null);

        // Держать экран включённым во время звонков
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Для показа поверх экрана блокировки
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }

        handleIntent(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Log.d(TAG, "🔔 onNewIntent получен");
        handleIntent(intent);
    }

    /**
     * Обработка Intent — проверяет данные о входящих звонках
     */
    private void handleIntent(Intent intent) {
        if (intent == null) return;

        Bundle extras = intent.getExtras();
        if (extras == null) return;

        // Логируем extras
        for (String key : extras.keySet()) {
            Object value = extras.get(key);
            Log.d(TAG, "   Extra: " + key + " = " + value);
        }

        String type = extras.getString("type");
        String from = extras.getString("from");
        String isVideoStr = extras.getString("isVideo");

        // Обработка входящего звонка
        if ("incoming_call".equals(type) && from != null && !from.isEmpty()) {
            boolean isVideo = "true".equals(isVideoStr);

            Log.d(TAG, "========================================");
            Log.d(TAG, "📞 ВХОДЯЩИЙ ЗВОНОК от: " + from);
            Log.d(TAG, "📞 Видео: " + isVideo);
            Log.d(TAG, "========================================");

            sendIncomingCallEvent(from, isVideo);
        }
        // Обработка сообщения
        else if ("message".equals(type) && from != null) {
            Log.d(TAG, "💬 НОВОЕ СООБЩЕНИЕ от: " + from);
        }
    }

    /**
     * Отправка события о входящем звонке в React Native
     * Если ReactContext ещё не готов — сохраняем для отправки в onResume
     */
    private void sendIncomingCallEvent(String from, boolean isVideo) {
        try {
            ReactContext reactContext = getReactNativeHost()
                    .getReactInstanceManager()
                    .getCurrentReactContext();

            if (reactContext != null && reactContext.hasActiveReactInstance()) {
                com.facebook.react.bridge.WritableMap params =
                        com.facebook.react.bridge.Arguments.createMap();
                params.putString("from", from);
                params.putBoolean("isVideo", isVideo);

                reactContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                        .emit("incomingCall", params);

                Log.d(TAG, "✅ Событие incomingCall отправлено в React Native");
                // Очистить pending
                hasPendingCall = false;
            } else {
                Log.w(TAG, "⚠️ ReactContext не готов, сохраняем pending call");
                pendingCallFrom = from;
                pendingCallIsVideo = isVideo;
                hasPendingCall = true;

                // Попробуем отправить через 2 секунды
                getWindow().getDecorView().postDelayed(() -> {
                    if (hasPendingCall) {
                        sendIncomingCallEvent(pendingCallFrom, pendingCallIsVideo);
                    }
                }, 2000);
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Ошибка отправки события: " + e.getMessage());

            // Сохраняем pending call
            pendingCallFrom = from;
            pendingCallIsVideo = isVideo;
            hasPendingCall = true;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        Log.d(TAG, "✨ onResume");

        // Отправить pending call если есть
        if (hasPendingCall && pendingCallFrom != null) {
            Log.d(TAG, "📞 Обработка pending звонка от: " + pendingCallFrom);
            // Задержка чтобы React Native успел инициализироваться
            getWindow().getDecorView().postDelayed(() -> {
                if (hasPendingCall) {
                    sendIncomingCallEvent(pendingCallFrom, pendingCallIsVideo);
                }
            }, 1500);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        Log.d(TAG, "🌙 onPause");
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "⛔ onDestroy");
    }

    @Override
    public void invokeDefaultOnBackPressed() {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
            if (!moveTaskToBack(false)) {
                super.invokeDefaultOnBackPressed();
            }
            return;
        }
        super.invokeDefaultOnBackPressed();
    }
}