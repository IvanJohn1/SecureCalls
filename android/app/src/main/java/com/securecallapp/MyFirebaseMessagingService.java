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
 * MyFirebaseMessagingService v2.0 FIX
 * ═══════════════════════════════════════════════════════════
 *
 * ИСПРАВЛЕНИЯ:
 * - Сохранение FCM токена в SharedPreferences для повторной отправки
 * - Правильный notification channel с AudioAttributes для Android 15
 * - Wake экрана при входящем звонке
 * - Уникальные ID для missed call notifications
 * - Улучшенный fullScreenIntent для Android 15
 */
public class MyFirebaseMessagingService extends FirebaseMessagingService {
    private static final String TAG = "FCMService";
    private static final String CHANNEL_ID_CALLS = "incoming_calls";
    private static final String CHANNEL_ID_MESSAGES = "messages";
    private static final String CHANNEL_ID_MISSED = "missed_calls";

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "========================================");
        Log.d(TAG, "📱 Firebase Messaging Service v2.0 СОЗДАН");
        Log.d(TAG, "========================================");
        createNotificationChannels();
    }

    /**
     * Сохранить новый FCM токен
     */
    @Override
    public void onNewToken(String token) {
        Log.d(TAG, "========================================");
        Log.d(TAG, "🔑 НОВЫЙ FCM ТОКЕН");
        Log.d(TAG, "Токен: " + token);
        Log.d(TAG, "========================================");

        // Сохранить токен в SharedPreferences
        SharedPreferences prefs = getSharedPreferences("SecureCallPrefs", MODE_PRIVATE);
        prefs.edit().putString("fcm_token", token).apply();
    }

    /**
     * Обработка входящего сообщения
     */
    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Log.d(TAG, "========================================");
        Log.d(TAG, "📬 ПОЛУЧЕНО FCM СООБЩЕНИЕ");
        Log.d(TAG, "От: " + remoteMessage.getFrom());
        Log.d(TAG, "========================================");

        Map<String, String> data = remoteMessage.getData();

        if (data.isEmpty()) {
            Log.w(TAG, "⚠️ Пустое data payload");

            // Проверить notification payload (если сервер использует notification вместо data)
            RemoteMessage.Notification notification = remoteMessage.getNotification();
            if (notification != null) {
                Log.d(TAG, "📋 Notification payload: title=" + notification.getTitle() +
                        " body=" + notification.getBody());
            }
            return;
        }

        // Логировать все данные
        Log.d(TAG, "📦 Data payload:");
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
        } else {
            Log.w(TAG, "⚠️ Неизвестный тип уведомления: " + type);
        }
    }

    /**
     * КРИТИЧНО: Обработка входящего звонка при закрытом приложении
     */
    private void handleIncomingCall(Map<String, String> data) {
        String from = data.get("from");
        String isVideoStr = data.get("isVideo");
        boolean isVideo = "true".equals(isVideoStr);

        Log.d(TAG, "========================================");
        Log.d(TAG, "📞 ВХОДЯЩИЙ ЗВОНОК");
        Log.d(TAG, "От: " + from);
        Log.d(TAG, "Видео: " + isVideo);
        Log.d(TAG, "========================================");

        if (from == null || from.isEmpty()) {
            Log.e(TAG, "❌ Нет информации об отправителе");
            return;
        }

        // WAKE экрана для показа уведомления
        wakeScreen();

        // Intent для открытия приложения по нажатию на уведомление
        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                Intent.FLAG_ACTIVITY_CLEAR_TOP |
                Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("type", "incoming_call");
        intent.putExtra("from", from);
        intent.putExtra("isVideo", String.valueOf(isVideo));

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Full-screen Intent для показа поверх экрана блокировки
        Intent fullScreenIntent = new Intent(this, MainActivity.class);
        fullScreenIntent.setAction(Intent.ACTION_MAIN);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra("type", "incoming_call");
        fullScreenIntent.putExtra("from", from);
        fullScreenIntent.putExtra("isVideo", String.valueOf(isVideo));

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                this,
                1,
                fullScreenIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Построить notification
        String title = isVideo ? "📹 Видеозвонок" : "📞 Входящий звонок";
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
                .setTimeoutAfter(30000);

        // Показать notification
        NotificationManager notificationManager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        if (notificationManager != null) {
            notificationManager.notify(9999, builder.build());
            Log.d(TAG, "✅ Notification о входящем звонке показан");
        }
    }

    /**
     * Обработка нового сообщения
     */
    private void handleNewMessage(Map<String, String> data) {
        String from = data.get("from");
        String message = data.get("message");

        Log.d(TAG, "💬 НОВОЕ СООБЩЕНИЕ от: " + from);

        if (from == null || message == null) {
            Log.e(TAG, "❌ Недостаточно данных для сообщения");
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
                .setContentTitle("💬 " + from)
                .setContentText(message)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);

        NotificationManager notificationManager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        if (notificationManager != null) {
            int notificationId = ("msg_" + from).hashCode();
            notificationManager.notify(notificationId, builder.build());
            Log.d(TAG, "✅ Notification о сообщении показан");
        }
    }

    /**
     * Обработка пропущенного звонка
     * FIX: уникальный ID для каждого пропущенного звонка
     */
    private void handleMissedCall(Map<String, String> data) {
        String from = data.get("from");
        String isVideoStr = data.get("isVideo");
        boolean isVideo = "true".equals(isVideoStr);

        Log.d(TAG, "========================================");
        Log.d(TAG, "📵 ПРОПУЩЕННЫЙ ЗВОНОК от: " + from);
        Log.d(TAG, "========================================");

        if (from == null || from.isEmpty()) {
            Log.e(TAG, "❌ Нет информации об отправителе");
            return;
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

        String title = isVideo ? "📵 Пропущенный видеозвонок" : "📵 Пропущенный звонок";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID_MISSED)
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setContentTitle(title)
                .setContentText("От: " + from)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        NotificationManager notificationManager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        if (notificationManager != null) {
            // FIX: Уникальный ID на основе from + timestamp
            int notificationId = ("missed_" + from + "_" + System.currentTimeMillis()).hashCode();
            notificationManager.notify(notificationId, builder.build());
            Log.d(TAG, "✅ Notification о пропущенном звонке показан, id=" + notificationId);
        }
    }

    /**
     * FIX: Разбудить экран при входящем звонке
     */
    private void wakeScreen() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            if (powerManager != null) {
                PowerManager.WakeLock wakeLock = powerManager.newWakeLock(
                        PowerManager.FULL_WAKE_LOCK |
                                PowerManager.ACQUIRE_CAUSES_WAKEUP |
                                PowerManager.ON_AFTER_RELEASE,
                        "SecureCall::IncomingCallWake"
                );
                wakeLock.acquire(10000); // 10 секунд
                Log.d(TAG, "✅ Экран разбужен");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Ошибка пробуждения экрана: " + e.getMessage());
        }
    }

    /**
     * Создание notification channels (Android 8.0+)
     * FIX: Правильные AudioAttributes для Android 15
     */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager notificationManager = getSystemService(NotificationManager.class);

            if (notificationManager == null) {
                Log.e(TAG, "❌ NotificationManager null");
                return;
            }

            Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            Uri notificationUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

            AudioAttributes audioAttributes = new AudioAttributes.Builder()
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
            callsChannel.setSound(ringtoneUri, audioAttributes);
            callsChannel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
            callsChannel.setBypassDnd(true);
            notificationManager.createNotificationChannel(callsChannel);

            // Канал для сообщений
            NotificationChannel messagesChannel = new NotificationChannel(
                    CHANNEL_ID_MESSAGES,
                    "Сообщения",
                    NotificationManager.IMPORTANCE_DEFAULT
            );
            messagesChannel.setDescription("Уведомления о новых сообщениях");
            messagesChannel.setSound(notificationUri, null);
            notificationManager.createNotificationChannel(messagesChannel);

            // Канал для пропущенных звонков
            NotificationChannel missedCallsChannel = new NotificationChannel(
                    CHANNEL_ID_MISSED,
                    "Пропущенные звонки",
                    NotificationManager.IMPORTANCE_DEFAULT
            );
            missedCallsChannel.setDescription("Уведомления о пропущенных звонках");
            missedCallsChannel.setSound(notificationUri, null);
            notificationManager.createNotificationChannel(missedCallsChannel);

            Log.d(TAG, "✅ Notification channels созданы");
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "⛔ Firebase Messaging Service уничтожен");
    }
}