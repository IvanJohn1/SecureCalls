package com.securecallapp;

import com.facebook.react.ReactActivity;
import com.facebook.react.ReactActivityDelegate;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactActivityDelegate;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.view.WindowManager;
import android.content.Intent;
import android.util.Log;

public class MainActivity extends ReactActivity {
    private static final String TAG = "MainActivity";

    private String pendingCallFrom = null;
    private boolean pendingCallIsVideo = false;
    private String pendingCallId = null;
    private boolean hasPendingCall = false;

    // Retry mechanism for pending call delivery.
    // When the app is cold-started from a notification, ReactContext isn't ready
    // immediately. We retry every 500ms for up to 15 seconds.
    private final Handler pendingCallHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingCallRetryRunnable;
    private int pendingCallRetryCount = 0;
    private static final int PENDING_CALL_MAX_RETRIES = 30;    // 30 x 500ms = 15s
    private static final int PENDING_CALL_RETRY_INTERVAL = 500; // ms

    @Override
    protected String getMainComponentName() {
        return "SecureCallApp";
    }

    @Override
    protected ReactActivityDelegate createReactActivityDelegate() {
        return new DefaultReactActivityDelegate(
                this,
                getMainComponentName(),
                DefaultNewArchitectureEntryPoint.getFabricEnabled()
        );
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        Log.d(TAG, "onCreate");
        super.onCreate(null);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            //noinspection deprecation
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }

        handleIntent(getIntent());
        checkBatteryOptimization();
    }

    private void checkBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                Log.w(TAG, "Battery optimization is ON");
                try {
                    ReactContext reactContext = getReactNativeHost()
                            .getReactInstanceManager()
                            .getCurrentReactContext();
                    if (reactContext != null && reactContext.hasActiveReactInstance()) {
                        reactContext
                                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                .emit("batteryOptimizationEnabled", null);
                    }
                } catch (Exception e) {
                    // ReactContext may not be ready yet
                }
            }
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;

        Bundle extras = intent.getExtras();
        if (extras == null) return;

        Log.d(TAG, "--- Intent Extras ---");
        for (String key : extras.keySet()) {
            //noinspection deprecation
            Object value = extras.get(key);
            Log.d(TAG, "  " + key + " = " + value);
        }

        String type = extras.getString("type");
        String from = extras.getString("from");
        String isVideoStr = extras.getString("isVideo");
        String callId = extras.getString("callId");

        if ("incoming_call".equals(type) && from != null && !from.isEmpty()) {
            boolean isVideo = "true".equals(isVideoStr);
            Log.d(TAG, "INCOMING CALL from: " + from + " video=" + isVideo + " callId=" + callId);
            startPendingCallDelivery(from, isVideo, callId);
        } else if ("message".equals(type) && from != null) {
            Log.d(TAG, "NEW MESSAGE from: " + from);
        }
    }

    /**
     * Start delivering the pending call event to JS with retry mechanism.
     *
     * When the app is launched from a notification (cold start), ReactContext
     * is not ready yet. We retry every 500ms for up to 15 seconds to ensure
     * the event is delivered after React Native and the navigation stack
     * have fully initialized (LoginScreen auto-login → HomeScreen).
     */
    private void startPendingCallDelivery(String from, boolean isVideo, String callId) {
        stopPendingCallRetry();

        pendingCallFrom = from;
        pendingCallIsVideo = isVideo;
        pendingCallId = callId;
        hasPendingCall = true;
        pendingCallRetryCount = 0;

        // Try immediately first
        if (trySendIncomingCallEvent()) {
            return;
        }

        // Start retry loop
        pendingCallRetryRunnable = new Runnable() {
            @Override
            public void run() {
                if (!hasPendingCall) return;

                pendingCallRetryCount++;
                Log.d(TAG, "Pending call retry " + pendingCallRetryCount + "/" + PENDING_CALL_MAX_RETRIES);

                if (trySendIncomingCallEvent()) {
                    return;
                }

                if (pendingCallRetryCount < PENDING_CALL_MAX_RETRIES) {
                    pendingCallHandler.postDelayed(this, PENDING_CALL_RETRY_INTERVAL);
                } else {
                    Log.e(TAG, "Pending call delivery failed after " + PENDING_CALL_MAX_RETRIES + " retries");
                    hasPendingCall = false;
                }
            }
        };

        pendingCallHandler.postDelayed(pendingCallRetryRunnable, PENDING_CALL_RETRY_INTERVAL);
    }

    /**
     * Try to send the incoming call event to JS.
     * @return true if successfully sent, false if ReactContext not ready
     */
    private boolean trySendIncomingCallEvent() {
        if (!hasPendingCall || pendingCallFrom == null) return true;

        try {
            ReactContext reactContext = getReactNativeHost()
                    .getReactInstanceManager()
                    .getCurrentReactContext();

            if (reactContext != null && reactContext.hasActiveReactInstance()) {
                WritableMap params = Arguments.createMap();
                params.putString("from", pendingCallFrom);
                params.putBoolean("isVideo", pendingCallIsVideo);
                if (pendingCallId != null) {
                    params.putString("callId", pendingCallId);
                }

                reactContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                        .emit("incomingCall", params);

                Log.d(TAG, "incomingCall event sent to JS (retry " + pendingCallRetryCount + ")");
                hasPendingCall = false;
                stopPendingCallRetry();
                return true;
            }
        } catch (Exception e) {
            Log.w(TAG, "ReactContext not ready: " + e.getMessage());
        }

        return false;
    }

    private void stopPendingCallRetry() {
        if (pendingCallRetryRunnable != null) {
            pendingCallHandler.removeCallbacks(pendingCallRetryRunnable);
            pendingCallRetryRunnable = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (hasPendingCall) {
            pendingCallHandler.postDelayed(() -> {
                if (hasPendingCall) {
                    trySendIncomingCallEvent();
                }
            }, 300);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopPendingCallRetry();
    }

    @Override
    public void invokeDefaultOnBackPressed() {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
            if (!moveTaskToBack(false)) {
                super.invokeDefaultOnBackPressed();
            }
            return;
        }
        super.invokeDefaultOnBackPressed();
    }
}
