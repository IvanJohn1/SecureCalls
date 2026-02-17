package com.securecallapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

/**
 * ═══════════════════════════════════════════════════════════
 * BootReceiver - Автозапуск Foreground Service после перезагрузки
 * ═══════════════════════════════════════════════════════════
 * 
 * ФУНКЦИИ:
 * - Запуск ConnectionForegroundService после BOOT_COMPLETED
 * - Проверка наличия сохраненной авторизации
 * - Восстановление соединения с сервером
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        
        Log.d(TAG, "========================================");
        Log.d(TAG, "📱 BootReceiver получил событие");
        Log.d(TAG, "Action: " + action);
        Log.d(TAG, "========================================");

        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(action) ||
            "com.htc.intent.action.QUICKBOOT_POWERON".equals(action)) {
            
            // Проверить, есть ли сохраненные данные авторизации
            SharedPreferences prefs = context.getSharedPreferences(
                "RCTAsyncLocalStorage_SecureCall", 
                Context.MODE_PRIVATE
            );
            
            String username = prefs.getString("username", null);
            String token = prefs.getString("token", null);
            
            if (username != null && token != null) {
                Log.d(TAG, "✅ Найдены данные авторизации");
                Log.d(TAG, "👤 Пользователь: " + username);
                Log.d(TAG, "🚀 Запуск Foreground Service...");
                
                try {
                    // Запустить Foreground Service
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(
                            new Intent(context, ConnectionForegroundService.class)
                        );
                    } else {
                        context.startService(
                            new Intent(context, ConnectionForegroundService.class)
                        );
                    }
                    
                    Log.d(TAG, "✅ Foreground Service запущен");
                } catch (Exception e) {
                    Log.e(TAG, "❌ Ошибка запуска Foreground Service: " + e.getMessage());
                    e.printStackTrace();
                }
            } else {
                Log.d(TAG, "⚠️ Нет сохраненных данных авторизации");
                Log.d(TAG, "ℹ️ Foreground Service не запущен");
            }
        }
        
        Log.d(TAG, "========================================");
    }
}
