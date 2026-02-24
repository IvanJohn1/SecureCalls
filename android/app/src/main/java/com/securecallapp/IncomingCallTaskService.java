package com.securecallapp;

import android.content.Intent;
import android.os.Bundle;
import com.facebook.react.HeadlessJsTaskService;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;
import android.util.Log;

/**
 * IncomingCallTaskService — launches a Headless JS Task when an incoming call
 * arrives via FCM while the app is killed.
 *
 * This allows JS code to run in the background:
 *  1. Connect the Socket.IO client
 *  2. Authenticate with the saved token
 *  3. Keep the socket alive so that when the user taps the notification,
 *     the socket is already ready for accept_call.
 */
public class IncomingCallTaskService extends HeadlessJsTaskService {
    private static final String TAG = "IncomingCallTaskSvc";

    @Override
    protected HeadlessJsTaskConfig getTaskConfig(Intent intent) {
        Bundle extras = intent.getExtras();
        if (extras == null) {
            Log.w(TAG, "No extras in intent, skipping task");
            return null;
        }

        WritableMap data = Arguments.createMap();
        data.putString("from", extras.getString("from", ""));
        data.putString("callId", extras.getString("callId", ""));
        data.putBoolean("isVideo", extras.getBoolean("isVideo", false));

        Log.d(TAG, "Starting IncomingCallTask: from=" + extras.getString("from")
                + " callId=" + extras.getString("callId"));

        return new HeadlessJsTaskConfig(
            "IncomingCallTask",
            data,
            30000,  // 30s task lifetime
            true    // allow when app is in foreground too
        );
    }
}
