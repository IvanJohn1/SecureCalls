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
 * MainApplication v3.0 — Android 15 (16KB page size) fix
 *
 * SIGSEGV (SEGV_ACCERR) при загрузке .so файлов вызван несовместимостью
 * ELF p_align=4096 с 16KB page size. Решение на уровне манифеста:
 * extractNativeLibs="true" + useLegacyPackaging=true в Gradle.
 * SoLoader.init обёрнут в try-catch для обработки UnsatisfiedLinkError.
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

        // Инициализация SoLoader.
        // SIGSEGV при загрузке .so — нативный сигнал, не ловится Java try-catch.
        // Основной фикс — extractNativeLibs=true в манифесте + useLegacyPackaging
        // в Gradle, которые заставляют систему извлекать .so на диск
        // с правильным выравниванием страниц (16KB на Android 15).
        // try-catch здесь обрабатывает только Java-уровневые ошибки (UnsatisfiedLinkError).
        try {
            SoLoader.init(this, /* native exopackage */ false);
            Log.d(TAG, "SoLoader initialized successfully");
        } catch (UnsatisfiedLinkError e) {
            Log.e(TAG, "SoLoader native library loading failed: " + e.getMessage(), e);
            throw e; // Re-throw — без SoLoader приложение не может работать
        } catch (Exception e) {
            Log.e(TAG, "SoLoader init failed: " + e.getMessage(), e);
            throw new RuntimeException("SoLoader initialization failed", e);
        }

        if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
            DefaultNewArchitectureEntryPoint.load();
        }
    }
}