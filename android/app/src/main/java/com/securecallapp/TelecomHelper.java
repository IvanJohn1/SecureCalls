package com.securecallapp;

import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.telecom.PhoneAccount;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.util.Log;

/**
 * TelecomHelper — utility class for Android Telecom API integration.
 *
 * Manages PhoneAccount registration and incoming call reporting.
 * Uses CAPABILITY_SELF_MANAGED which is designed for VoIP apps that
 * handle their own call UI (like Signal, WhatsApp, Telegram).
 *
 * Self-managed PhoneAccounts:
 *  - Auto-enabled (no user action needed)
 *  - Don't interfere with the default dialer
 *  - Provide process priority elevation during calls
 *  - Prevent Samsung Freecess from freezing the app during calls
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
     * Must be called at least once (typically at app startup / login).
     * Safe to call multiple times — TelecomManager handles idempotency.
     *
     * @return true if registration succeeded, false if Telecom API unavailable
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
     *
     * This is what gives the app Samsung Freecess immunity:
     * Android marks the process as handling an active call.
     *
     * @return true if call was reported via Telecom, false if fallback needed
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

            // Always re-register PhoneAccount — the sRegistered flag may be stale
            // after device reboot, battery optimization change, or OEM-specific revocation.
            // TelecomManager.registerPhoneAccount() is idempotent, so this is safe.
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
