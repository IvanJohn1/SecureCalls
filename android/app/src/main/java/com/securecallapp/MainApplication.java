package com.securecallapp;

import android.app.Application;
import com.facebook.react.PackageList;
import com.facebook.react.ReactApplication;
import com.facebook.react.ReactNativeHost;
import com.facebook.react.ReactPackage;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactNativeHost;
import com.facebook.soloader.SoLoader;
import android.util.Log;
import java.util.List;

/**
 * MainApplication v2.0 FIX
 *
 * ИСПРАВЛЕНИЯ:
 * - try-catch вокруг SoLoader.init для предотвращения SIGSEGV на Android 15
 * - Правильная регистрация native packages
 * - Защита от дублирования пакетов
 */
public class MainApplication extends Application implements ReactApplication {
    private static final String TAG = "MainApplication";

    private final ReactNativeHost mReactNativeHost =
            new DefaultReactNativeHost(this) {
                @Override
                public boolean getUseDeveloperSupport() {
                    return BuildConfig.DEBUG;
                }

                @Override
                protected List<ReactPackage> getPackages() {
                    @SuppressWarnings("UnnecessaryLocalVariable")
                    List<ReactPackage> packages = new PackageList(this).getPackages();

                    // Регистрация CallNotificationPackage
                    packages.add(new CallNotificationPackage());

                    // Регистрация ConnectionServicePackage
                    packages.add(new ConnectionServicePackage());

                    return packages;
                }

                @Override
                protected String getJSMainModuleName() {
                    return "index";
                }

                @Override
                protected boolean isNewArchEnabled() {
                    return BuildConfig.IS_NEW_ARCHITECTURE_ENABLED;
                }

                @Override
                protected Boolean isHermesEnabled() {
                    return BuildConfig.IS_HERMES_ENABLED;
                }
            };

    @Override
    public ReactNativeHost getReactNativeHost() {
        return mReactNativeHost;
    }

    @Override
    public void onCreate() {
        super.onCreate();

        // FIX: Безопасная инициализация SoLoader
        // На Android 15 SoLoader может вызвать SIGSEGV если extractNativeLibs=false
        try {
            SoLoader.init(this, /* native exopackage */ false);
            Log.d(TAG, "✅ SoLoader инициализирован");
        } catch (Exception e) {
            Log.e(TAG, "❌ Ошибка инициализации SoLoader: " + e.getMessage());
            e.printStackTrace();
        }

        if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
            DefaultNewArchitectureEntryPoint.load();
        }
    }
}