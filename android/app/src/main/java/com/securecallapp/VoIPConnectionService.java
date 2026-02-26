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
 * VoIPConnectionService v2.0 — Android Telecom ConnectionService.
 *
 * ДОБАВЛЕНО v2.0:
 * ─────────────────────────────────────────────────────────────
 * onCreateOutgoingConnection() — обработка исходящих звонков через Telecom.
 *
 * ПРОБЛЕМА (до v2.0):
 * Метод не был реализован. HomeScreen инициировал WebRTC напрямую,
 * минуя Telecom. Android не знал о звонке → Freecess мог убить процесс.
 *
 * РЕШЕНИЕ:
 * Исходящий звонок теперь проходит через TelecomManager.placeCall()
 * → onCreateOutgoingConnection() → VoIPConnection(isOutgoing=true).
 * Процесс получает иммунитет Freecess на всё время звонка.
 *
 * ДОПОЛНИТЕЛЬНО:
 * onCreateOutgoingConnectionFailed() — лог ошибки для отладки.
 * ─────────────────────────────────────────────────────────────
 *
 * Логика входящих звонков v1.0 без изменений.
 */
@RequiresApi(api = Build.VERSION_CODES.O)
public class VoIPConnectionService extends ConnectionService {
    private static final String TAG = "VoIPConnectionSvc";
    private static final String CHANNEL_ID = "incoming_calls_v2";
    private static final int NOTIFICATION_ID = 9999;

    private static VoIPConnection sActiveConnection;

    // ─────────────────────────────────────────────────────────
    // ВХОДЯЩИЕ ЗВОНКИ
    // ─────────────────────────────────────────────────────────

    @Override
    public Connection onCreateIncomingConnection(
            PhoneAccountHandle connectionManagerPhoneAccount,
            ConnectionRequest request) {

        Bundle extras = request.getExtras();
        String from = extras.getString("from", "Unknown");
        String callId = extras.getString("callId", "");
        boolean isVideo = extras.getBoolean("isVideo", false);

        Log.d(TAG, "onCreateIncomingConnection: from=" + from + " callId=" + callId);

        VoIPConnection connection = new VoIPConnection(this, from, callId, isVideo, false);
        connection.setRinging();

        sActiveConnection = connection;

        // SELF_MANAGED = нет системного UI → показываем своё уведомление
        showFullScreenNotification(from, callId, isVideo);

        return connection;
    }

    @Override
    public void onCreateIncomingConnectionFailed(
            PhoneAccountHandle connectionManagerPhoneAccount,
            ConnectionRequest request) {
        Log.e(TAG, "onCreateIncomingConnectionFailed — fallback notification already shown by FCM");
    }

    // ─────────────────────────────────────────────────────────
    // ИСХОДЯЩИЕ ЗВОНКИ (NEW v2.0)
    // ─────────────────────────────────────────────────────────

    /**
     * NEW v2.0: Вызывается TelecomManager при placeCall().
     *
     * Создаём VoIPConnection в состоянии DIALING.
     * JS стартует WebRTC в CallScreen параллельно.
     * Когда удалённая сторона ответит — ConnectionServiceModule.setOutgoingCallActive()
     * переводит соединение в ACTIVE.
     *
     * Для исходящих звонков НЕ показываем FullScreenIntent уведомление —
     * пользователь сам инициировал звонок и уже видит CallScreen.
     */
    @Override
    public Connection onCreateOutgoingConnection(
            PhoneAccountHandle connectionManagerPhoneAccount,
            ConnectionRequest request) {

        Bundle extras = request.getExtras();
        String peer = extras.getString("peer", "Unknown");
        String callId = extras.getString("callId", "");
        boolean isVideo = extras.getBoolean("isVideo", false);

        Log.d(TAG, "onCreateOutgoingConnection: peer=" + peer + " callId=" + callId);

        VoIPConnection connection = new VoIPConnection(this, peer, callId, isVideo, true);
        connection.setDialing();

        sActiveConnection = connection;

        Log.d(TAG, "Outgoing VoIPConnection created (DIALING state), Freecess immunity active");
        return connection;
    }

    @Override
    public void onCreateOutgoingConnectionFailed(
            PhoneAccountHandle connectionManagerPhoneAccount,
            ConnectionRequest request) {
        Bundle extras = request != null ? request.getExtras() : null;
        String peer = extras != null ? extras.getString("peer", "?") : "?";
        Log.e(TAG, "onCreateOutgoingConnectionFailed: peer=" + peer
                + " — Telecom отклонил исходящий звонок (PhoneAccount не зарегистрирован?)");
        // JS уже на CallScreen — он получит ошибку WebRTC и вернётся сам
    }

    // ─────────────────────────────────────────────────────────
    // УВЕДОМЛЕНИЯ (только для входящих)
    // ─────────────────────────────────────────────────────────

    private void showFullScreenNotification(String from, String callId, boolean isVideo) {
        try {
            createNotificationChannel();

            Intent contentIntent = new Intent(this, MainActivity.class);
            contentIntent.setAction(Intent.ACTION_MAIN);
            contentIntent.addCategory(Intent.CATEGORY_LAUNCHER);
            contentIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                    Intent.FLAG_ACTIVITY_CLEAR_TOP |
                    Intent.FLAG_ACTIVITY_SINGLE_TOP);
            contentIntent.putExtra("type", "incoming_call");
            contentIntent.putExtra("from", from);
            contentIntent.putExtra("isVideo", String.valueOf(isVideo));
            if (callId != null) contentIntent.putExtra("callId", callId);

            PendingIntent contentPendingIntent = PendingIntent.getActivity(
                    this, 0, contentIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Intent fullScreenIntent = new Intent(this, MainActivity.class);
            fullScreenIntent.setAction(Intent.ACTION_MAIN);
            fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                    Intent.FLAG_ACTIVITY_CLEAR_TOP);
            fullScreenIntent.putExtra("type", "incoming_call");
            fullScreenIntent.putExtra("from", from);
            fullScreenIntent.putExtra("isVideo", String.valueOf(isVideo));
            if (callId != null) fullScreenIntent.putExtra("callId", callId);

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

    // ─────────────────────────────────────────────────────────
    // СТАТИЧЕСКИЕ МЕТОДЫ ДЛЯ JS-МОСТА
    // ─────────────────────────────────────────────────────────

    public static VoIPConnection getActiveConnection() {
        return sActiveConnection;
    }

    public static void clearActiveConnection() {
        sActiveConnection = null;
    }
}
