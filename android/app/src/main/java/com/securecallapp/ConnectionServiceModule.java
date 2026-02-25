package com.securecallapp;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import android.os.Build;
import android.util.Log;

/**
 * ConnectionServiceModule - Native Module для управления Foreground Service
 * и Android Telecom API (VoIP ConnectionService).
 *
 * Позволяет JavaScript коду:
 *  - Управлять ConnectionForegroundService (keepalive)
 *  - Регистрировать PhoneAccount для Telecom API (Freecess immunity)
 *  - Завершать звонки через Telecom framework
 */
public class ConnectionServiceModule extends ReactContextBaseJavaModule {
    private static final String TAG = "ConnectionServiceModule";
    private final ReactApplicationContext reactContext;

    public ConnectionServiceModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return "ConnectionService";
    }

    /**
     * Запустить Foreground Service
     */
    @ReactMethod
    public void start(Promise promise) {
        try {
            Log.d(TAG, "Запуск ConnectionForegroundService");
            ConnectionForegroundService.start(reactContext);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Ошибка запуска: " + e.getMessage());
            promise.reject("START_ERROR", "Не удалось запустить сервис", e);
        }
    }

    /**
     * Остановить Foreground Service
     */
    @ReactMethod
    public void stop(Promise promise) {
        try {
            Log.d(TAG, "Остановка ConnectionForegroundService");
            ConnectionForegroundService.stop(reactContext);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Ошибка остановки: " + e.getMessage());
            promise.reject("STOP_ERROR", "Не удалось остановить сервис", e);
        }
    }

    /**
     * Проверить, запущен ли сервис — реальная проверка через ActivityManager
     */
    @ReactMethod
    @SuppressWarnings("deprecation")
    public void isRunning(Promise promise) {
        try {
            android.app.ActivityManager manager = (android.app.ActivityManager)
                reactContext.getSystemService(android.content.Context.ACTIVITY_SERVICE);

            if (manager != null) {
                for (android.app.ActivityManager.RunningServiceInfo info :
                        manager.getRunningServices(Integer.MAX_VALUE)) {
                    if (ConnectionForegroundService.class.getName()
                            .equals(info.service.getClassName())) {
                        promise.resolve(true);
                        return;
                    }
                }
            }
            promise.resolve(false);
        } catch (Exception e) {
            Log.e(TAG, "Error checking service status: " + e.getMessage());
            promise.reject("CHECK_ERROR", "Ошибка проверки статуса", e);
        }
    }

    /**
     * Register PhoneAccount with Android Telecom framework.
     * Gives the app immunity from Samsung Freecess during incoming calls.
     * Must be called at least once (at login / app start).
     */
    @ReactMethod
    public void registerPhoneAccount(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                promise.resolve(false);
                return;
            }
            boolean success = TelecomHelper.registerPhoneAccount(reactContext);
            Log.d(TAG, "PhoneAccount registration: " + (success ? "OK" : "FAILED"));
            promise.resolve(success);
        } catch (Exception e) {
            Log.e(TAG, "Error registering PhoneAccount: " + e.getMessage());
            promise.reject("TELECOM_ERROR", e.getMessage(), e);
        }
    }

    /**
     * End the active Telecom call connection.
     * Must be called when a call ends to properly release Telecom resources.
     */
    @ReactMethod
    public void endTelecomCall(Promise promise) {
        try {
            TelecomHelper.endActiveCall();
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Error ending Telecom call: " + e.getMessage());
            promise.reject("TELECOM_ERROR", e.getMessage(), e);
        }
    }
}
