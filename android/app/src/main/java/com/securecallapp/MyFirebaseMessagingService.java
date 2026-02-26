package com.securecallapp;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * ═══════════════════════════════════════════════════════════
 * MyFirebaseMessagingService v3.1 FIX
 * ═══════════════════════════════════════════════════════════
 *
 * ИСПРАВЛЕНИЕ v3.1:
 *
 * БАГ: onNewToken() сохранял FCM токен в SharedPreferences "SecureCallPrefs",
 *      тогда как BootReceiver читает из NativeStorageModule.PREFS_NAME
 *      = "SecureCallNativePrefs". После ротации токена (переустановка,
 *      плановая ротация Firebase) BootReceiver не мог найти токен и не
 *      запускал ConnectionForegroundService после перезагрузки устройства.
 *
 * ФИКС: onNewToken() теперь пишет в NativeStorageModule.PREFS_NAME
 *       (то же хранилище, что NativeStorageModule.saveFcmToken() из JS).
 *
 * Остальные исправления v3.0 без изменений (см. ниже).
 */
public class MyFirebaseMessagingService extends FirebaseMessagingService {
    private static final String TAG = "FCMService";

    // v2 channel IDs — force fresh channels with correct importance
    private static final String CHANNEL_ID_CALLS = "incoming_calls_v2";
    private static final String CHANNEL_ID_MESSAGES = "messages_v2";
    private static final String CHANNEL_ID_MISSED = "missed_calls_v2";

    private static final int INCOMING_CALL_NOTIFICATION_ID = 9999;

    // Static to survive service recreation; prevents WakeLock leaks on repeated calls
    private static PowerManager.WakeLock sIncomingCallWakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "========================================");
        Log.d(TAG, "Firebase Messaging Service v3.1 CREATED");
        Log.d(TAG, "========================================");
        deleteOldNotificationChannels();
        createNotificationChannels();
    }

    @Override
    public void onNewToken(String token) {
        Log.d(TAG, "NEW FCM TOKEN: " + token);

        // FIX v3.1: Используем NativeStorageModule.PREFS_NAME ("SecureCallNativePrefs")
        // вместо "SecureCallPrefs". BootReceiver читает именно из SecureCallNativePrefs.
        // Несовпадение хранилища приводило к тому, что после ротации токена
        // BootReceiver не мог запустить сервис после перезагрузки.
        getSharedPreferences(NativeStorageModule.PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putString("fcm_token", token)
                .apply();

        Log.d(TAG, "FCM token saved to " + NativeStorageModule.PREFS_NAME);
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Log.d(TAG, "========================================");
        Log.d(TAG, "FCM MESSAGE RECEIVED (onMessageReceived called!)");
        Log.d(TAG, "From: " + remoteMessage.getFrom());
        Log.d(TAG, "========================================");

        Map<String, String> data = remoteMessage.getData();

        if (data.isEmpty()) {
            Log.w(TAG, "Empty data payload");
            RemoteMessage.Notification notification = remoteMessage.getNotification();
            if (notification != null) {
                Log.d(TAG, "Notification payload: title=" + notification.getTitle() +
                        " body=" + notification.getBody());
            }
            return;
        }

        Log.d(TAG, "Data payload:");
        for (Map.Entry<String, String> entry : data.entrySet()) {
            Log.d(TAG, "   " + entry.getKey() + " = " + entry.getValue());
        }

        String type = data.get("type");

        if ("incoming_call".equals(type)) {
            handleIncomingCall(data);
        } else if ("message".equals(type)) {
            handleNewMessage(data);
        } else if ("missed_call".equals(type)) {
            handleMissedCall(data);
        } else if ("call_cancelled".equals(type)) {
            handleCallCancelled(data);
        } else {
            Log.w(TAG, "Unknown notification type: " + type);
        }
    }

    /**
     * КРИТИЧНО: Обработка входящего звонка при закрытом приложении
     *
     * Strategy (like Signal/WhatsApp/Telegram):
     *  1. Report call via TelecomManager → process gets Freecess immunity
     *  2. Show notification (always — Telecom doesn't show UI for self-managed)
     *  3. Start HeadlessTask to pre-connect socket
     */
    private void handleIncomingCall(Map<String, String> data) {
        String from = data.get("from");
        String isVideoStr = data.get("isVideo");
        String callId = data.get("callId");
        boolean isVideo = "true".equals(isVideoStr);

        Log.d(TAG, "========================================");
        Log.d(TAG, "INCOMING CALL");
        Log.d(TAG, "From: " + from);
        Log.d(TAG, "Video: " + isVideo);
        Log.d(TAG, "CallId: " + callId);
        Log.d(TAG, "========================================");

        if (from == null || from.isEmpty()) {
            Log.e(TAG, "No sender info");
            return;
        }

        // WAKE CPU for processing
        wakeScreen();

        // ─── Step 1: Report to Telecom (Freecess immunity) ───
        boolean telecomSuccess = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                telecomSuccess = TelecomHelper.reportIncomingCall(this, from, callId, isVideo);
                if (telecomSuccess) {
                    Log.d(TAG, "Step 1 OK: Call reported via TelecomManager (Freecess immunity active)");
                } else {
                    Log.w(TAG, "Step 1 FAIL: TelecomManager failed, using notification fallback");
                }
            } catch (Exception e) {
                Log.e(TAG, "Step 1 ERROR: TelecomManager exception: " + e.getMessage());
            }
        } else {
            Log.w(TAG, "Step 1 SKIP: API < 26, Telecom self-managed not available");
        }

        // ─── Step 2: Show notification (always — self-managed has no system UI) ───
        showIncomingCallNotification(from, callId, isVideo);

        // ─── Step 3: Start HeadlessTask to pre-connect socket ───
        try {
            Intent taskIntent = new Intent(this, IncomingCallTaskService.class);
            taskIntent.putExtra("from", from);
            taskIntent.putExtra("callId", callId != null ? callId : "");
            taskIntent.putExtra("isVideo", isVideo);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(taskIntent);
            } else {
                startService(taskIntent);
            }
            Log.d(TAG, "Step 3 OK: IncomingCallTaskService started");
        } catch (Exception e) {
            Log.e(TAG, "Step 3 ERROR: " + e.getMessage());
        }
    }

    /**
     * Show the incoming call notification with full-screen intent.
     */
    private void showIncomingCallNotification(String from, String callId, boolean isVideo) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                Intent.FLAG_ACTIVITY_CLEAR_TOP |
                Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("type", "incoming_call");
        intent.putExtra("from", from);
        intent.putExtra("isVideo", String.valueOf(isVideo));
        if (callId != null) {
            intent.putExtra("callId", callId);
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

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
                this,
                1,
                fullScreenIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String title = isVideo ? "Видеозвонок" : "Входящий звонок";
        String text = from + " звонит вам";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID_CALLS)
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setContentTitle(title)
                .setContentText(text)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setAutoCancel(true)
                .setOngoing(true)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .setContentIntent(pendingIntent)
                .setVibrate(new long[]{0, 500, 300, 500, 300, 500})
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setTimeoutAfter(30000);

        NotificationManager notificationManager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        if (notificationManager != null) {
            notificationManager.notify(INCOMING_CALL_NOTIFICATION_ID, builder.build());
            Log.d(TAG, "Incoming call notification shown (ID=" + INCOMING_CALL_NOTIFICATION_ID + ")");
        }
    }

    /**
     * Обработка нового сообщения
     */
    private void handleNewMessage(Map<String, String> data) {
        String from = data.get("from");
        String message = data.get("message");

        Log.d(TAG, "NEW MESSAGE from: " + from);

        if (from == null || message == null) {
            Log.e(TAG, "Insufficient data for message");
            return;
        }

        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("type", "message");
        intent.putExtra("from", from);

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID_MESSAGES)
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setContentTitle(from)
                .setContentText(message)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);

        NotificationManager notificationManager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        if (notificationManager != null) {
            int notificationId = ("msg_" + from).hashCode();
            notificationManager.notify(notificationId, builder.build());
            Log.d(TAG, "Message notification shown");
        }
    }

    /**
     * Обработка пропущенного звонка
     */
    private void handleMissedCall(Map<String, String> data) {
        String from = data.get("from");
        String isVideoStr = data.get("isVideo");
        boolean isVideo = "true".equals(isVideoStr);

        Log.d(TAG, "========================================");
        Log.d(TAG, "MISSED CALL from: " + from);
        Log.d(TAG, "========================================");

        if (from == null || from.isEmpty()) {
            Log.e(TAG, "No sender info");
            return;
        }

        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(INCOMING_CALL_NOTIFICATION_ID);
        }

        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String title = isVideo ? "Пропущенный видеозвонок" : "Пропущенный звонок";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID_MISSED)
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setContentTitle(title)
                .setContentText("От: " + from)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        if (nm != null) {
            int notificationId = ("missed_" + from + "_" + System.currentTimeMillis()).hashCode();
            nm.notify(notificationId, builder.build());
            Log.d(TAG, "Missed call notification shown, id=" + notificationId);
        }
    }

    /**
     * Обработка отмены звонка
     */
    private void handleCallCancelled(Map<String, String> data) {
        String from = data.get("from");
        Log.d(TAG, "CALL CANCELLED by: " + from);

        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(INCOMING_CALL_NOTIFICATION_ID);
            Log.d(TAG, "Incoming call notification dismissed");
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            TelecomHelper.endActiveCall();
        }
    }

    /**
     * Разбудить CPU при входящем звонке.
     */
    private void wakeScreen() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm == null) return;

            synchronized (MyFirebaseMessagingService.class) {
                if (sIncomingCallWakeLock != null && sIncomingCallWakeLock.isHeld()) {
                    sIncomingCallWakeLock.release();
                }
                sIncomingCallWakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "SecureCall::IncomingCallWake"
                );
                sIncomingCallWakeLock.acquire(30_000L);
            }
            Log.d(TAG, "WakeLock activated (30s)");
        } catch (Exception e) {
            Log.e(TAG, "WakeLock error: " + e.getMessage());
        }
    }

    /**
     * Delete old notification channels that may have cached wrong importance.
     */
    private void deleteOldNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;

            String[] oldChannelIds = {
                "incoming_calls",
                "messages",
                "missed_calls",
            };

            for (String channelId : oldChannelIds) {
                if (nm.getNotificationChannel(channelId) != null) {
                    nm.deleteNotificationChannel(channelId);
                    Log.d(TAG, "Deleted old channel: " + channelId);
                }
            }
        }
    }

    /**
     * Create notification channels with correct importance.
     */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager notificationManager = getSystemService(NotificationManager.class);

            if (notificationManager == null) {
                Log.e(TAG, "NotificationManager null");
                return;
            }

            Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            Uri notificationUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

            AudioAttributes callAudioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .build();

            // Канал для входящих звонков — IMPORTANCE_HIGH
            NotificationChannel callsChannel = new NotificationChannel(
                    CHANNEL_ID_CALLS,
                    "Входящие звонки",
                    NotificationManager.IMPORTANCE_HIGH
            );
            callsChannel.setDescription("Уведомления о входящих звонках");
            callsChannel.enableVibration(true);
            callsChannel.setVibrationPattern(new long[]{0, 500, 300, 500, 300, 500});
            callsChannel.setSound(ringtoneUri, callAudioAttributes);
            callsChannel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
            callsChannel.setBypassDnd(true);
            notificationManager.createNotificationChannel(callsChannel);

            // Канал для сообщений — IMPORTANCE_HIGH
            NotificationChannel messagesChannel = new NotificationChannel(
                    CHANNEL_ID_MESSAGES,
                    "Сообщения",
                    NotificationManager.IMPORTANCE_HIGH
            );
            messagesChannel.setDescription("Уведомления о новых сообщениях");
            messagesChannel.setSound(notificationUri, null);
            notificationManager.createNotificationChannel(messagesChannel);

            // Канал для пропущенных звонков — IMPORTANCE_HIGH
            NotificationChannel missedCallsChannel = new NotificationChannel(
                    CHANNEL_ID_MISSED,
                    "Пропущенные звонки",
                    NotificationManager.IMPORTANCE_HIGH
            );
            missedCallsChannel.setDescription("Уведомления о пропущенных звонках");
            missedCallsChannel.setSound(notificationUri, null);
            missedCallsChannel.setBypassDnd(true);
            notificationManager.createNotificationChannel(missedCallsChannel);

            Log.d(TAG, "Notification channels created (v2)");
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "Firebase Messaging Service destroyed");
    }
}
