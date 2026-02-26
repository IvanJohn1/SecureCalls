package com.securecallapp;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import android.os.Build;
import android.util.Log;

/**
 * ConnectionServiceModule v2.0
 *
 * ДОБАВЛЕНО v2.0:
 * ─────────────────────────────────────────────────────────────
 * placeCall(peer, isVideo, promise) — регистрация исходящего звонка в Telecom.
 *
 * setOutgoingCallActive(promise) — перевод исходящего звонка в ACTIVE
 *   когда удалённая сторона ответила.
 *
 * ПРОБЛЕМА (до v2.0):
 * Исходящие звонки не регистрировались в TelecomManager.
 * HomeScreen.makeCall() шёл напрямую в WebRTC, минуя Telecom.
 * Android не знал о звонке → Samsung Freecess мог убить процесс.
 *
 * РЕШЕНИЕ:
 * HomeScreen.makeCall() теперь вызывает ConnectionService.placeCall()
 * перед навигацией на CallScreen. Telecom регистрирует звонок,
 * VoIPConnectionService создаёт VoIPConnection в DIALING состоянии.
 * ─────────────────────────────────────────────────────────────
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

    /**
     * NEW v2.0: Разместить исходящий звонок через Android Telecom.
     *
     * Вызывается из HomeScreen.makeCall() ПЕРЕД навигацией на CallScreen.
     * Регистрирует звонок в TelecomManager → процесс получает
     * иммунитет от Samsung Freecess на время звонка.
     *
     * @param peer    имя вызываемого пользователя
     * @param isVideo true для видеозвонка
     */
    @ReactMethod
    public void placeCall(String peer, boolean isVideo, Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                // API < 26: Telecom self-managed не поддерживается, продолжаем без него
                Log.w(TAG, "placeCall: API < 26, Telecom unavailable — continuing without it");
                promise.resolve(false);
                return;
            }

            boolean success = TelecomHelper.placeOutgoingCall(reactContext, peer, null, isVideo);
            Log.d(TAG, "placeCall(" + peer + ", video=" + isVideo + "): " + (success ? "OK" : "FAILED"));
            promise.resolve(success);
        } catch (Exception e) {
            Log.e(TAG, "Error placing call: " + e.getMessage());
            // Не отвергаем промис — JS должен продолжить звонок даже без Telecom
            promise.resolve(false);
        }
    }

    /**
     * NEW v2.0: Перевести активное исходящее соединение в ACTIVE состояние.
     *
     * Вызывается из CallScreen когда удалённая сторона ответила на звонок
     * (получен webrtc_answer или accept_call от сервера).
     */
    @ReactMethod
    public void setOutgoingCallActive(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                promise.resolve(false);
                return;
            }
            VoIPConnection conn = VoIPConnectionService.getActiveConnection();
            if (conn != null && conn.getIsOutgoing()) {
                conn.setCallActive();
                Log.d(TAG, "Outgoing call set ACTIVE");
                promise.resolve(true);
            } else {
                Log.w(TAG, "setOutgoingCallActive: no active outgoing connection found");
                promise.resolve(false);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error setting call active: " + e.getMessage());
            promise.reject("TELECOM_ERROR", e.getMessage(), e);
        }
    }
}
