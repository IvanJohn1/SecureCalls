package com.securecallapp;

import com.facebook.react.ReactActivity;
import com.facebook.react.ReactActivityDelegate;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactActivityDelegate;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.Arguments; // Добавлен импорт
import com.facebook.react.bridge.WritableMap; // Добавлен импорт
import com.facebook.react.modules.core.DeviceEventManagerModule;
import android.os.Bundle;
import android.os.Build;
import android.view.WindowManager;
import android.content.Intent;
import android.util.Log;

public class MainActivity extends ReactActivity {
    private static final String TAG = "MainActivity";

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
        Log.d(TAG, "📱 onCreate вызван");
        // super.onCreate(null) — правильное решение для react-native-screens
        super.onCreate(null);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // ИСПРАВЛЕНО: FLAG_SHOW_WHEN_LOCKED и FLAG_TURN_SCREEN_ON deprecated с API 27.
        // setShowWhenLocked/setTurnScreenOn уже используются для O_MR1+.
        // Для более старых API (< 27) флаги окна — единственный способ, замены нет.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            //noinspection deprecation
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
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;

        Bundle extras = intent.getExtras();
        if (extras == null) return;

        // ИСПРАВЛЕНО: Bundle.get(String) deprecated с API 33. Для debug-лога применяем
        // noinspection — typed-getters здесь не подходят, т.к. типы ключей заранее неизвестны.
        Log.d(TAG, "--- Intent Extras Start ---");
        for (String key : extras.keySet()) {
            //noinspection deprecation
            Object value = extras.get(key);
            Log.d(TAG, "Extra: " + key + " = " + value);
        }
        Log.d(TAG, "--- Intent Extras End ---");

        String type = extras.getString("type");
        String from = extras.getString("from");
        String isVideoStr = extras.getString("isVideo");

        // ИСПРАВЛЕНО: Убран мусорный текст "for (String key : bundle.keySet()) {"
        if ("incoming_call".equals(type) && from != null && !from.isEmpty()) {
            boolean isVideo = "true".equals(isVideoStr);

            Log.d(TAG, "📞 ВХОДЯЩИЙ ЗВОНОК от: " + from + " (Video: " + isVideo + ")");
            sendIncomingCallEvent(from, isVideo);
        } else if ("message".equals(type) && from != null) {
            Log.d(TAG, "💬 НОВОЕ СООБЩЕНИЕ от: " + from);
        }
    }

    private void sendIncomingCallEvent(String from, boolean isVideo) {
        try {
            ReactContext reactContext = getReactNativeHost()
                    .getReactInstanceManager()
                    .getCurrentReactContext();

            if (reactContext != null && reactContext.hasActiveReactInstance()) {
                // Используем Arguments для создания карты
                WritableMap params = Arguments.createMap();
                params.putString("from", from);
                params.putBoolean("isVideo", isVideo);

                reactContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                        .emit("incomingCall", params);

                Log.d(TAG, "✅ Событие отправлено в JS");
                hasPendingCall = false;
            } else {
                Log.w(TAG, "⚠️ ReactContext не готов, сохраняем в pending");
                pendingCallFrom = from;
                pendingCallIsVideo = isVideo;
                hasPendingCall = true;
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Ошибка отправки: " + e.getMessage());
            pendingCallFrom = from;
            pendingCallIsVideo = isVideo;
            hasPendingCall = true;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (hasPendingCall && pendingCallFrom != null) {
            getWindow().getDecorView().postDelayed(() -> {
                if (hasPendingCall) {
                    sendIncomingCallEvent(pendingCallFrom, pendingCallIsVideo);
                }
            }, 1500);
        }
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