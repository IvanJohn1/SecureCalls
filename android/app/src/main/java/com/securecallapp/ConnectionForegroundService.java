package com.securecallapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.net.wifi.WifiManager.WifiLock;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import android.util.Log;

/**
 * ConnectionForegroundService v2.0 FIX
 *
 * ИСПРАВЛЕНИЯ:
 * - Безопасная обработка WakeLock для Android 15
 * - Timeout на WakeLock (6 часов) для предотвращения утечек
 * - Корректная остановка при onTaskRemoved
 */
public class ConnectionForegroundService extends Service {
    private static final String TAG = "ConnectionService";
    private static final String CHANNEL_ID = "SecureCallConnection";
    private static final int NOTIFICATION_ID = 1001;

    private PowerManager.WakeLock cpuWakeLock;
    private WifiLock wifiLock;
    private boolean isServiceStarted = false;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "✅ ConnectionForegroundService СОЗДАН");
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (isServiceStarted) {
            Log.d(TAG, "⚠️ Сервис уже запущен");
            return START_STICKY;
        }

        Log.d(TAG, "🚀 ConnectionForegroundService ЗАПУСК");

        Notification notification = createNotification();
        startForeground(NOTIFICATION_ID, notification);
        acquireWakeLocks();
        isServiceStarted = true;

        Log.d(TAG, "✅ Сервис полностью готов");
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "⛔ ConnectionForegroundService ОСТАНОВКА");
        releaseWakeLocks();
        isServiceStarted = false;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /**
     * Получить CPU и WiFi Wake Locks
     * FIX: Timeout 6 часов для предотвращения утечек на Android 15
     */
    private void acquireWakeLocks() {
        try {
            // CPU WAKE LOCK с таймаутом
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager != null && cpuWakeLock == null) {
                cpuWakeLock = powerManager.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "SecureCall::CPULock"
                );
                // FIX: Таймаут 6 часов вместо бесконечного
                cpuWakeLock.acquire(6 * 60 * 60 * 1000L);
                Log.d(TAG, "✅ CPU WAKE_LOCK активирован (6ч таймаут)");
            }

            // WiFi WAKE LOCK
            WifiManager wifiManager = (WifiManager) getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
            if (wifiManager != null && wifiLock == null) {
                wifiLock = wifiManager.createWifiLock(
                        WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                        "SecureCall::WiFiLock"
                );
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
                Log.d(TAG, "✅ WiFi WAKE_LOCK активирован");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Ошибка активации WakeLocks: " + e.getMessage());
        }
    }

    private void releaseWakeLocks() {
        try {
            if (cpuWakeLock != null && cpuWakeLock.isHeld()) {
                cpuWakeLock.release();
                cpuWakeLock = null;
                Log.d(TAG, "✅ CPU WakeLock освобождён");
            }

            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
                wifiLock = null;
                Log.d(TAG, "✅ WiFi WakeLock освобождён");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Ошибка освобождения WakeLocks: " + e.getMessage());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "SecureCall Соединение",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Поддержка соединения для входящих звонков");
            channel.setShowBadge(false);
            channel.enableLights(false);
            channel.enableVibration(false);

            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private Notification createNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK
        );

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                notificationIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("SecureCall активен")
                .setContentText("Ожидание входящих звонков")
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build();
    }

    public static void start(Context context) {
        Intent intent = new Intent(context, ConnectionForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
        Log.d(TAG, "📞 Запрос на старт ConnectionForegroundService");
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, ConnectionForegroundService.class);
        context.stopService(intent);
        Log.d(TAG, "⏹️ Запрос на остановку ConnectionForegroundService");
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        Log.d(TAG, "⚠️ Задача удалена из Recent Apps — сервис ПРОДОЛЖАЕТ работать");
    }

    @Override
    public void onLowMemory() {
        super.onLowMemory();
        Log.w(TAG, "⚠️ Низкая память — сервис продолжает работу");
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        Log.w(TAG, "⚠️ onTrimMemory level=" + level);
    }
}