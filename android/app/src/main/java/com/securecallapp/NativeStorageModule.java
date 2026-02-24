package com.securecallapp;

import android.content.SharedPreferences;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import android.util.Log;

/**
 * NativeStorageModule - SharedPreferences storage accessible from both JS and native Java.
 *
 * AsyncStorage uses SQLite (RKStorage) which is not reliably readable from
 * BroadcastReceivers or Services outside of React Native context.
 * This module duplicates critical credentials into SharedPreferences so that
 * BootReceiver and other native components can read them after device reboot.
 */
public class NativeStorageModule extends ReactContextBaseJavaModule {
    private static final String TAG = "NativeStorageModule";
    public static final String PREFS_NAME = "SecureCallNativePrefs";

    public NativeStorageModule(ReactApplicationContext ctx) {
        super(ctx);
    }

    @Override
    public String getName() {
        return "NativeStorage";
    }

    @ReactMethod
    public void saveCredentials(String username, String token, Promise promise) {
        try {
            getReactApplicationContext()
                .getSharedPreferences(PREFS_NAME, 0)
                .edit()
                .putString("username", username)
                .putString("token", token)
                .apply();
            Log.d(TAG, "Credentials saved to SharedPreferences");
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Error saving credentials: " + e.getMessage());
            promise.reject("SAVE_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void saveFcmToken(String fcmToken, Promise promise) {
        try {
            getReactApplicationContext()
                .getSharedPreferences(PREFS_NAME, 0)
                .edit()
                .putString("fcm_token", fcmToken)
                .apply();
            Log.d(TAG, "FCM token saved to SharedPreferences");
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Error saving FCM token: " + e.getMessage());
            promise.reject("SAVE_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void clearCredentials(Promise promise) {
        try {
            getReactApplicationContext()
                .getSharedPreferences(PREFS_NAME, 0)
                .edit()
                .remove("username")
                .remove("token")
                .apply();
            Log.d(TAG, "Credentials cleared from SharedPreferences");
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Error clearing credentials: " + e.getMessage());
            promise.reject("CLEAR_ERROR", e.getMessage(), e);
        }
    }
}
