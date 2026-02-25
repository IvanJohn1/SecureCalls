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
 * CRITICAL FIX: HeadlessJsTaskService does NOT call startForeground() by itself.
 * Since MyFirebaseMessagingService starts this service via startForegroundService(),
 * we MUST call startForeground() within 5 seconds or Android throws
 * ForegroundServiceDidNotStartInTimeException.
 *
 * The foreground notification also prevents Samsung Freecess from re-freezing
 * the process after FCM delivery, giving the HeadlessTask time to connect the socket.
 */
public class IncomingCallTaskService extends HeadlessJsTaskService {
    private static final String TAG = "IncomingCallTaskSvc";
    private static final String CHANNEL_ID = "incoming_call_task";
    private static final int NOTIFICATION_ID = 2001;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // MUST call startForeground() before delegating to HeadlessJsTaskService
        createNotificationChannel();
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setContentTitle("SecureCall")
                .setContentText("Обработка входящего звонка...")
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setOngoing(true)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        Log.d(TAG, "Foreground notification shown, delegating to HeadlessJsTaskService");
        return super.onStartCommand(intent, flags, startId);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "IncomingCallTaskService destroyed");
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

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Обработка звонков",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Фоновая обработка входящих звонков");
            channel.setShowBadge(false);

            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }
}
