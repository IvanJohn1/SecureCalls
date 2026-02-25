package com.securecallapp;

import android.os.Build;
import android.os.Bundle;
import android.telecom.Connection;
import android.telecom.ConnectionRequest;
import android.telecom.ConnectionService;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.util.Log;

import androidx.annotation.RequiresApi;

/**
 * VoIPConnectionService — Android Telecom framework ConnectionService.
 *
 * This is the key component that gives the app immunity from Samsung Freecess
 * and other aggressive battery optimizers. When a call is reported via
 * TelecomManager.addNewIncomingCall(), Android:
 *
 *  1. Creates an incoming connection through this service
 *  2. Elevates the app's process priority (lowered oom_score_adj)
 *  3. Prevents Freecess from freezing the process
 *  4. Keeps WakeLocks active
 *  5. Grants foreground execution privileges
 *
 * This is the same architecture used by Signal, WhatsApp, and Telegram.
 *
 * For CAPABILITY_SELF_MANAGED connections:
 *  - The app manages its own call UI (IncomingCallScreen)
 *  - The system does NOT show native dialer UI
 *  - But the process protection still applies
 */
@RequiresApi(api = Build.VERSION_CODES.O)
public class VoIPConnectionService extends ConnectionService {
    private static final String TAG = "VoIPConnectionSvc";

    // Static reference to active connection for the JS bridge
    private static VoIPConnection sActiveConnection;

    @Override
    public Connection onCreateIncomingConnection(
            PhoneAccountHandle connectionManagerPhoneAccount,
            ConnectionRequest request) {

        Bundle extras = request.getExtras();
        String from = extras.getString("from", "Unknown");
        String callId = extras.getString("callId", "");
        boolean isVideo = extras.getBoolean("isVideo", false);

        Log.d(TAG, "onCreateIncomingConnection: from=" + from + " callId=" + callId);

        VoIPConnection connection = new VoIPConnection(this, from, callId, isVideo);
        connection.setRinging();

        sActiveConnection = connection;

        return connection;
    }

    @Override
    public void onCreateIncomingConnectionFailed(
            PhoneAccountHandle connectionManagerPhoneAccount,
            ConnectionRequest request) {
        Log.e(TAG, "onCreateIncomingConnectionFailed — falling back to notification");
        // The notification was already shown by MyFirebaseMessagingService
        // so the user can still tap it. No additional action needed.
    }

    public static VoIPConnection getActiveConnection() {
        return sActiveConnection;
    }

    public static void clearActiveConnection() {
        sActiveConnection = null;
    }
}
