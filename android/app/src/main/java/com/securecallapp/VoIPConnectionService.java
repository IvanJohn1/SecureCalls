package com.securecallapp;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.telecom.Connection;
import android.telecom.ConnectionRequest;
import android.telecom.ConnectionService;
import android.telecom.PhoneAccountHandle;
import android.util.Log;

import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;

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
 * CRITICAL: CAPABILITY_SELF_MANAGED means the system does NOT show any call UI.
 * We MUST show a FullScreenIntent notification ourselves to wake the screen
 * and display the incoming call screen.
 */
@RequiresApi(api = Build.VERSION_CODES.O)
public class VoIPConnectionService extends ConnectionService {
    private static final String TAG = "VoIPConnectionSvc";
    private static final String CHANNEL_ID = "incoming_calls_v2";
    private static final int NOTIFICATION_ID = 9999;

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

        // CRITICAL: SELF_MANAGED means no system UI — we must show our own.
        // This FullScreenIntent notification wakes the screen on locked devices
        // and shows a heads-up notification on unlocked devices.
        // Uses the same notification ID (9999) as MyFirebaseMessagingService
        // to replace the fallback notification with a better one.
        showFullScreenNotification(from, callId, isVideo);

        return connection;
    }

    /**
     * Show a high-priority notification with FullScreenIntent for the incoming call.
     *
     * This replaces the notification shown by MyFirebaseMessagingService (same ID 9999).
     * FullScreenIntent is the ONLY way to wake a locked screen and display an Activity
     * from a background service on Android 10+.
     */
    private void showFullScreenNotification(String from, String callId, boolean isVideo) {
        try {
            createNotificationChannel();

            // Content intent: opens app when notification is tapped
            Intent contentIntent = new Intent(this, MainActivity.class);
            contentIntent.setAction(Intent.ACTION_MAIN);
            contentIntent.addCategory(Intent.CATEGORY_LAUNCHER);
            contentIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                    Intent.FLAG_ACTIVITY_CLEAR_TOP |
                    Intent.FLAG_ACTIVITY_SINGLE_TOP);
            contentIntent.putExtra("type", "incoming_call");
            contentIntent.putExtra("from", from);
            contentIntent.putExtra("isVideo", String.valueOf(isVideo));
            if (callId != null) {
                contentIntent.putExtra("callId", callId);
            }

            PendingIntent contentPendingIntent = PendingIntent.getActivity(
                    this, 0, contentIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            // FullScreen intent: wakes screen and shows activity over lock screen
            Intent fullScreenIntent = new Intent(this, MainActivity.class);
            fullScreenIntent.setAction(Intent.ACTION_MAIN);
            fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                    Intent.FLAG_ACTIVITY_CLEAR_TOP);
            fullScreenIntent.putExtra("type", "incoming_call");
            fullScreenIntent.putExtra("from", from);
            fullScreenIntent.putExtra("isVideo", String.valueOf(isVideo));
            if (callId != null) {
                fullScreenIntent.putExtra("callId", callId);
            }

            PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                    this, 1, fullScreenIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            String title = isVideo ? "Видеозвонок" : "Входящий звонок";
            String text = from + " звонит вам";

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_menu_call)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setAutoCancel(true)
                    .setOngoing(true)
                    .setFullScreenIntent(fullScreenPendingIntent, true)
                    .setContentIntent(contentPendingIntent)
                    .setVibrate(new long[]{0, 500, 300, 500, 300, 500})
                    .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                    .setTimeoutAfter(30000);

            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(NOTIFICATION_ID, builder.build());
                Log.d(TAG, "FullScreenIntent notification shown (ID=" + NOTIFICATION_ID + ")");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error showing FullScreenIntent notification: " + e.getMessage());
        }
    }

    private void createNotificationChannel() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;

        // Channel may already exist from MyFirebaseMessagingService
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;

        Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .build();

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Входящие звонки",
                NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Уведомления о входящих звонках");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 500, 300, 500, 300, 500});
        channel.setSound(ringtoneUri, audioAttributes);
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        channel.setBypassDnd(true);

        nm.createNotificationChannel(channel);
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
