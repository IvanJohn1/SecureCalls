package com.securecallapp;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import android.util.Log;

/**
 * ConnectionServiceModule - Native Module для управления Foreground Service
 * 
 * Позволяет JavaScript коду управлять ConnectionForegroundService
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
     * Вызывается из JavaScript при успешном логине
     */
    @ReactMethod
    public void start(Promise promise) {
        try {
            Log.d(TAG, "📞 Запуск ConnectionForegroundService");
            ConnectionForegroundService.start(reactContext);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "❌ Ошибка запуска ConnectionForegroundService: " + e.getMessage());
            promise.reject("START_ERROR", "Не удалось запустить сервис", e);
        }
    }

    /**
     * Остановить Foreground Service
     * Вызывается из JavaScript при logout
     */
    @ReactMethod
    public void stop(Promise promise) {
        try {
            Log.d(TAG, "⏹️ Остановка ConnectionForegroundService");
            ConnectionForegroundService.stop(reactContext);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "❌ Ошибка остановки ConnectionForegroundService: " + e.getMessage());
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
}
