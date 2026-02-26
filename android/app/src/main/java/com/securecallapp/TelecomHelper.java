package com.securecallapp;

import android.content.ComponentName;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.telecom.PhoneAccount;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.util.Log;

/**
 * TelecomHelper v2.0 — утилита для Android Telecom API.
 *
 * ДОБАВЛЕНО v2.0:
 * ─────────────────────────────────────────────────────────────
 * placeOutgoingCall() — регистрация исходящего звонка в Telecom.
 *
 * ПРОБЛЕМА (до v2.0):
 * Исходящие звонки никогда не регистрировались в TelecomManager.
 * Android не знал, что приложение ведёт звонок.
 * Samsung Freecess мог убить процесс во время разговора,
 * так как сессия не была защищена Telecom.
 *
 * РЕШЕНИЕ:
 * HomeScreen.makeCall() теперь вызывает ConnectionService.placeCall(),
 * который вызывает TelecomHelper.placeOutgoingCall().
 * Это триггерит VoIPConnectionService.onCreateOutgoingConnection(),
 * что переводит процесс в защищённое состояние — как у Signal/WhatsApp.
 * ─────────────────────────────────────────────────────────────
 *
 * Остальная логика v1.0 без изменений.
 */
public class TelecomHelper {
    private static final String TAG = "TelecomHelper";
    private static final String PHONE_ACCOUNT_ID = "SecureCallVoIP";

    private static PhoneAccountHandle sPhoneAccountHandle;
    private static boolean sRegistered = false;

    /**
     * Get or create the PhoneAccountHandle singleton
     */
    public static PhoneAccountHandle getPhoneAccountHandle(Context context) {
        if (sPhoneAccountHandle == null) {
            ComponentName componentName = new ComponentName(
                    context, VoIPConnectionService.class);
            sPhoneAccountHandle = new PhoneAccountHandle(componentName, PHONE_ACCOUNT_ID);
        }
        return sPhoneAccountHandle;
    }

    /**
     * Register the PhoneAccount with TelecomManager.
     * Safe to call multiple times — TelecomManager handles idempotency.
     *
     * @return true if registration succeeded
     */
    public static boolean registerPhoneAccount(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            Log.w(TAG, "Telecom self-managed API requires Android 8.0+");
            return false;
        }

        try {
            TelecomManager telecomManager = (TelecomManager)
                    context.getSystemService(Context.TELECOM_SERVICE);
            if (telecomManager == null) {
                Log.e(TAG, "TelecomManager is null");
                return false;
            }

            PhoneAccountHandle handle = getPhoneAccountHandle(context);

            PhoneAccount account = PhoneAccount.builder(handle, "SecureCall")
                    .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
                    .addSupportedUriScheme(PhoneAccount.SCHEME_SIP)
                    .build();

            telecomManager.registerPhoneAccount(account);
            sRegistered = true;

            Log.d(TAG, "PhoneAccount registered successfully");
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Failed to register PhoneAccount: " + e.getMessage());
            return false;
        }
    }

    /**
     * Report an incoming call to the Android Telecom framework.
     * Gives the app Samsung Freecess immunity.
     *
     * @return true if call was reported via Telecom
     */
    public static boolean reportIncomingCall(
            Context context, String from, String callId, boolean isVideo) {

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            Log.w(TAG, "Telecom API not available on API < 26");
            return false;
        }

        try {
            TelecomManager telecomManager = (TelecomManager)
                    context.getSystemService(Context.TELECOM_SERVICE);
            if (telecomManager == null) {
                Log.e(TAG, "TelecomManager is null");
                return false;
            }

            // Always re-register PhoneAccount — sRegistered may be stale after reboot.
            registerPhoneAccount(context);

            PhoneAccountHandle handle = getPhoneAccountHandle(context);

            Bundle extras = new Bundle();
            extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle);
            extras.putString("from", from);
            extras.putString("callId", callId != null ? callId : "");
            extras.putBoolean("isVideo", isVideo);

            telecomManager.addNewIncomingCall(handle, extras);

            Log.d(TAG, "Incoming call reported to TelecomManager: from=" + from);
            return true;
        } catch (SecurityException e) {
            Log.e(TAG, "SecurityException (PhoneAccount not registered?): " + e.getMessage());
            return false;
        } catch (Exception e) {
            Log.e(TAG, "Failed to report incoming call: " + e.getMessage());
            return false;
        }
    }

    /**
     * NEW v2.0: Place an outgoing call via Android Telecom framework.
     *
     * Регистрирует исходящий звонок в TelecomManager. Это даёт приложению
     * иммунитет от Samsung Freecess во время исходящего звонка — точно так же
     * как Signal, WhatsApp, Telegram защищают свои исходящие звонки.
     *
     * Поток:
     * 1. HomeScreen → ConnectionServiceModule.placeCall()
     * 2. ConnectionServiceModule → TelecomHelper.placeOutgoingCall()
     * 3. TelecomManager → VoIPConnectionService.onCreateOutgoingConnection()
     * 4. VoIPConnection создан в DIALING состоянии
     * 5. JS начинает WebRTC (в CallScreen)
     *
     * @param context  контекст
     * @param peer     имя/адрес вызываемого абонента
     * @param callId   идентификатор звонка (может быть null до получения от сервера)
     * @param isVideo  видеозвонок
     * @return true если вызов успешно передан Telecom
     */
    public static boolean placeOutgoingCall(
            Context context, String peer, String callId, boolean isVideo) {

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            Log.w(TAG, "Telecom API not available on API < 26");
            return false;
        }

        try {
            TelecomManager telecomManager = (TelecomManager)
                    context.getSystemService(Context.TELECOM_SERVICE);
            if (telecomManager == null) {
                Log.e(TAG, "TelecomManager is null");
                return false;
            }

            // Всегда регистрируем PhoneAccount перед звонком
            registerPhoneAccount(context);

            PhoneAccountHandle handle = getPhoneAccountHandle(context);

            Bundle extras = new Bundle();
            extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle);
            extras.putString("peer", peer);
            extras.putString("callId", callId != null ? callId : "");
            extras.putBoolean("isVideo", isVideo);
            extras.putBoolean("isOutgoing", true);

            // URI в формате sip:peer@securecall
            Uri callUri = Uri.fromParts(PhoneAccount.SCHEME_SIP, peer, null);

            telecomManager.placeCall(callUri, extras);

            Log.d(TAG, "Outgoing call placed via TelecomManager: peer=" + peer);
            return true;
        } catch (SecurityException e) {
            Log.e(TAG, "SecurityException placing call (MANAGE_OWN_CALLS missing?): " + e.getMessage());
            return false;
        } catch (Exception e) {
            Log.e(TAG, "Failed to place outgoing call: " + e.getMessage());
            return false;
        }
    }

    /**
     * End the active Telecom connection (if any).
     * Called when the call ends from JS side.
     */
    public static void endActiveCall() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        VoIPConnection conn = VoIPConnectionService.getActiveConnection();
        if (conn != null) {
            conn.endCall();
            Log.d(TAG, "Active Telecom call ended");
        }
    }

    public static boolean isRegistered() {
        return sRegistered;
    }
}
