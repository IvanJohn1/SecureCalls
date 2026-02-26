package com.securecallapp;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.RingtoneManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import android.util.Log;

/**
 * CallNotificationModule - Показ уведомлений о звонках через Native API
 *
 * ИСПРАВЛЕНИЕ v2.0:
 * ─────────────────────────────────────────────────────────────
 * БАГ: intent.putExtra("isVideo", isVideo) клало Boolean в Intent.
 *      MainActivity.handleIntent() читает isVideo через extras.getString("isVideo"),
 *      что возвращает null для Boolean-экстра, а не "true"/"false".
 *      Результат: isVideo всегда == false, все видеозвонки показываются как аудио.
 *
 * ФИКС: String.valueOf(isVideo) → "true" или "false"
 *       Совместимо с остальным кодом (MyFirebaseMessagingService, VoIPConnectionService).
 * ─────────────────────────────────────────────────────────────
 */
public class CallNotificationModule extends ReactContextBaseJavaModule {
    private static final String TAG = "CallNotificationModule";
    private static final String CHANNEL_ID = "incoming_call_channel";
    private static final int NOTIFICATION_ID = 9999;

    private final ReactApplicationContext reactContext;

    public CallNotificationModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        createNotificationChannel();
    }

    @Override
    public String getName() {
        return "CallNotificationModule";
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Входящие звонки",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Уведомления о входящих звонках");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 300, 200, 300});

            NotificationManager notificationManager =
                reactContext.getSystemService(NotificationManager.class);
            notificationManager.createNotificationChannel(channel);

            Log.d(TAG, "✓ Notification channel создан");
        }
    }

    @ReactMethod
    public void showIncomingCallNotification(String from, boolean isVideo, String callId) {
        Log.d(TAG, "========================================");
        Log.d(TAG, "📞 ПОКАЗ NOTIFICATION О ЗВОНКЕ");
        Log.d(TAG, "От: " + from);
        Log.d(TAG, "Видео: " + isVideo);
        Log.d(TAG, "CallId: " + callId);
        Log.d(TAG, "========================================");

        try {
            // FIX v2.0: String.valueOf(isVideo) вместо boolean isVideo
            // MainActivity.handleIntent() читает через extras.getString("isVideo")
            // Boolean extras.getString() → null → "true".equals(null) → false (НЕВЕРНО)
            // String.valueOf(true) → "true" → "true".equals("true") → true (ВЕРНО)

            Intent intent = new Intent(reactContext, MainActivity.class);
            intent.setAction(Intent.ACTION_MAIN);
            intent.addCategory(Intent.CATEGORY_LAUNCHER);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                          Intent.FLAG_ACTIVITY_CLEAR_TOP |
                          Intent.FLAG_ACTIVITY_SINGLE_TOP);
            intent.putExtra("type", "incoming_call");
            intent.putExtra("from", from);
            intent.putExtra("isVideo", String.valueOf(isVideo)); // ← ИСПРАВЛЕНО
            if (callId != null && !callId.isEmpty()) {
                intent.putExtra("callId", callId);
            }

            PendingIntent pendingIntent = PendingIntent.getActivity(
                reactContext,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            Intent fullScreenIntent = new Intent(reactContext, MainActivity.class);
            fullScreenIntent.setAction(Intent.ACTION_MAIN);
            fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                                    Intent.FLAG_ACTIVITY_CLEAR_TOP);
            fullScreenIntent.putExtra("type", "incoming_call");
            fullScreenIntent.putExtra("from", from);
            fullScreenIntent.putExtra("isVideo", String.valueOf(isVideo)); // ← ИСПРАВЛЕНО
            if (callId != null && !callId.isEmpty()) {
                fullScreenIntent.putExtra("callId", callId);
            }

            PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                reactContext,
                1,
                fullScreenIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(
                reactContext,
                CHANNEL_ID
            )
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setContentTitle(isVideo ? "📹 Видеозвонок" : "📞 Звонок")
                .setContentText(from + " звонит вам")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setAutoCancel(true)
                .setOngoing(true)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .setContentIntent(pendingIntent)
                .setVibrate(new long[]{0, 300, 200, 300, 200, 300})
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

            NotificationManager notificationManager =
                (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
            notificationManager.notify(NOTIFICATION_ID, builder.build());

            Log.d(TAG, "✓ Notification показан");

        } catch (Exception e) {
            Log.e(TAG, "❌ Ошибка показа notification: " + e.getMessage());
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void cancelIncomingCallNotification() {
        Log.d(TAG, "Отмена notification о звонке");
        try {
            NotificationManager notificationManager =
                (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
            notificationManager.cancel(NOTIFICATION_ID);
            Log.d(TAG, "✓ Notification отменен");
        } catch (Exception e) {
            Log.e(TAG, "❌ Ошибка отмены notification: " + e.getMessage());
        }
    }
}