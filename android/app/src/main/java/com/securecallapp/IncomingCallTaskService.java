package com.securecallapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.NotificationCompat;
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
 *
 * FIX: Must call startForeground() because MyFirebaseMessagingService starts
 * this service via startForegroundService(). Without startForeground(),
 * Android 8+ crashes with ForegroundServiceDidNotStartInTimeException.
 */
public class IncomingCallTaskService extends HeadlessJsTaskService {
    private static final String TAG = "IncomingCallTaskSvc";
    private static final String CHANNEL_ID = "incoming_call_task";
    private static final int FG_NOTIFICATION_ID = 2001;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // CRITICAL: Must call startForeground() before super, because this service
        // is started via startForegroundService(). HeadlessJsTaskService does NOT
        // call startForeground() internally, causing ANR/crash on Android 8+.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            createChannelIfNeeded();
            Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_menu_call)
                    .setContentTitle("Подключение...")
                    .setContentText("Подготовка к входящему звонку")
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setOngoing(true)
                    .build();
            startForeground(FG_NOTIFICATION_ID, notification);
            Log.d(TAG, "startForeground() called");
        }
        return super.onStartCommand(intent, flags, startId);
    }

    private void createChannelIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Обработка входящего звонка",
                        NotificationManager.IMPORTANCE_LOW
                );
                channel.setShowBadge(false);
                channel.enableVibration(false);
                nm.createNotificationChannel(channel);
            }
        }
    }

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

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "IncomingCallTaskService destroyed");
    }
}
