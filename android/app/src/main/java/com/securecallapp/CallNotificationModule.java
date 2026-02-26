package com.securecallapp;

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
 * CallNotificationModule v2.1 FIX
 *
 * ИСПРАВЛЕНИЕ v2.1:
 * ─────────────────────────────────────────────────────────────
 * БАГ: CHANNEL_ID = "incoming_call_channel" — отдельный канал,
 *      отличный от "incoming_calls_v2", который используется везде.
 *      Канал "incoming_call_channel" создавался БЕЗ setBypassDnd(true)
 *      и без правильных AudioAttributes рингтона.
 *      Результат: при включённом DND (Не беспокоить) звонок, показанный
 *      через этот модуль (foreground), не давал звук и вибрацию.
 *
 * ФИКС: Используем канал "incoming_calls_v2", созданный в
 *       MyFirebaseMessagingService с правильными настройками.
 *       Убираем createNotificationChannel() — канал уже существует.
 *
 * ИСПРАВЛЕНИЕ v2.0 (сохранено):
 * ─────────────────────────────────────────────────────────────
 * БАГ: intent.putExtra("isVideo", isVideo) клало Boolean в Intent.
 *      MainActivity.handleIntent() читает через extras.getString("isVideo") → null.
 *
 * ФИКС: String.valueOf(isVideo) → "true" или "false"
 * ─────────────────────────────────────────────────────────────
 */
public class CallNotificationModule extends ReactContextBaseJavaModule {
    private static final String TAG = "CallNotificationModule";

    // FIX v2.1: Используем тот же канал что и MyFirebaseMessagingService.
    // Канал создан с setBypassDnd(true), ringtone AudioAttributes, IMPORTANCE_HIGH.
    private static final String CHANNEL_ID = "incoming_calls_v2";
    private static final int NOTIFICATION_ID = 9999;

    private final ReactApplicationContext reactContext;

    public CallNotificationModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        // Убираем createNotificationChannel() — "incoming_calls_v2" уже создан
        // в MyFirebaseMessagingService.onCreate() с правильными настройками.
    }

    @Override
    public String getName() {
        return "CallNotificationModule";
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
            Intent intent = new Intent(reactContext, MainActivity.class);
            intent.setAction(Intent.ACTION_MAIN);
            intent.addCategory(Intent.CATEGORY_LAUNCHER);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                          Intent.FLAG_ACTIVITY_CLEAR_TOP |
                          Intent.FLAG_ACTIVITY_SINGLE_TOP);
            intent.putExtra("type", "incoming_call");
            intent.putExtra("from", from);
            intent.putExtra("isVideo", String.valueOf(isVideo));
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
            fullScreenIntent.putExtra("isVideo", String.valueOf(isVideo));
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
                CHANNEL_ID  // FIX v2.1: "incoming_calls_v2" с DND bypass
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

            Log.d(TAG, "✓ Notification показан (channel: " + CHANNEL_ID + ")");

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
