package com.securecallapp;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/**
 * AudioModule — native audio control for VoIP calls
 *
 * Features:
 * 1. Ringtone playback (loop) + vibration for incoming calls
 * 2. Ringback tone for outgoing calls (caller hears "ringing")
 * 3. Speakerphone toggle
 * 4. Audio mode management (MODE_IN_COMMUNICATION for VoIP)
 * 5. Call volume control
 */
public class AudioModule extends ReactContextBaseJavaModule {
    private static final String TAG = "AudioModule";

    private final ReactApplicationContext reactContext;
    private MediaPlayer ringtonePlayer;
    private ToneGenerator ringbackTone;
    private Vibrator vibrator;
    private AudioManager audioManager;
    private boolean isRingtoneActive = false;

    public AudioModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.audioManager = (AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
        this.vibrator = (Vibrator) reactContext.getSystemService(Context.VIBRATOR_SERVICE);
    }

    @Override
    public String getName() {
        return "AudioModule";
    }

    // ═══════════════════════════════════════
    // RINGTONE — incoming call
    // ═══════════════════════════════════════

    @ReactMethod
    public void startRingtone() {
        Log.d(TAG, "startRingtone called");

        // Run on main thread for MediaPlayer safety
        if (isRingtoneActive) {
            Log.d(TAG, "Ringtone already active, skipping");
            return;
        }

        try {
            stopRingtoneInternal();

            Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (ringtoneUri == null) {
                ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }

            ringtonePlayer = new MediaPlayer();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                ringtonePlayer.setAudioAttributes(attrs);
            } else {
                ringtonePlayer.setAudioStreamType(AudioManager.STREAM_RING);
            }

            ringtonePlayer.setDataSource(reactContext, ringtoneUri);
            ringtonePlayer.setLooping(true);
            ringtonePlayer.prepare();
            ringtonePlayer.start();
            isRingtoneActive = true;

            // Vibrate alongside ringtone
            startVibration();

            Log.d(TAG, "Ringtone started successfully");
        } catch (Exception e) {
            Log.e(TAG, "Error starting ringtone: " + e.getMessage());
            isRingtoneActive = false;
            // Fallback: at least vibrate
            startVibration();
        }
    }

    @ReactMethod
    public void stopRingtone() {
        Log.d(TAG, "stopRingtone called");
        stopRingtoneInternal();
    }

    private void stopRingtoneInternal() {
        try {
            if (ringtonePlayer != null) {
                if (ringtonePlayer.isPlaying()) {
                    ringtonePlayer.stop();
                }
                ringtonePlayer.release();
                ringtonePlayer = null;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error stopping ringtone: " + e.getMessage());
            ringtonePlayer = null;
        }
        isRingtoneActive = false;
        stopVibration();
    }

    // ═══════════════════════════════════════
    // RINGBACK — outgoing call (caller hears "ringing")
    // ═══════════════════════════════════════

    @ReactMethod
    public void startRingback() {
        Log.d(TAG, "startRingback called");
        try {
            stopRingbackInternal();
            // Volume: 0-100, use 80 for comfortable level
            ringbackTone = new ToneGenerator(AudioManager.STREAM_VOICE_CALL, 80);
            ringbackTone.startTone(ToneGenerator.TONE_SUP_RINGTONE);
            Log.d(TAG, "Ringback started");
        } catch (Exception e) {
            Log.e(TAG, "Error starting ringback: " + e.getMessage());
        }
    }

    @ReactMethod
    public void stopRingback() {
        Log.d(TAG, "stopRingback called");
        stopRingbackInternal();
    }

    private void stopRingbackInternal() {
        try {
            if (ringbackTone != null) {
                ringbackTone.stopTone();
                ringbackTone.release();
                ringbackTone = null;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error stopping ringback: " + e.getMessage());
            ringbackTone = null;
        }
    }

    // ═══════════════════════════════════════
    // AUDIO MODE — VoIP mode
    // ═══════════════════════════════════════

    /**
     * Set audio mode to MODE_IN_COMMUNICATION.
     * This is CRITICAL for VoIP:
     * - Routes audio to earpiece (or speaker if toggled)
     * - Enables hardware echo cancellation
     * - Sets proper gain levels for voice
     * - Without this, audio goes through STREAM_MUSIC (too quiet for calls)
     */
    @ReactMethod
    public void setAudioModeInCall() {
        try {
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            audioManager.requestAudioFocus(
                    null,
                    AudioManager.STREAM_VOICE_CALL,
                    AudioManager.AUDIOFOCUS_GAIN
            );
            Log.d(TAG, "Audio mode: MODE_IN_COMMUNICATION");
        } catch (Exception e) {
            Log.e(TAG, "Error setting call audio mode: " + e.getMessage());
        }
    }

    @ReactMethod
    public void setAudioModeNormal() {
        try {
            audioManager.setMode(AudioManager.MODE_NORMAL);
            audioManager.abandonAudioFocus(null);
            Log.d(TAG, "Audio mode: MODE_NORMAL");
        } catch (Exception e) {
            Log.e(TAG, "Error resetting audio mode: " + e.getMessage());
        }
    }

    // ═══════════════════════════════════════
    // SPEAKERPHONE
    // ═══════════════════════════════════════

    @ReactMethod
    public void setSpeakerphone(boolean enabled) {
        try {
            audioManager.setSpeakerphoneOn(enabled);
            Log.d(TAG, "Speakerphone: " + (enabled ? "ON" : "OFF"));
        } catch (Exception e) {
            Log.e(TAG, "Error toggling speakerphone: " + e.getMessage());
        }
    }

    @ReactMethod
    public void isSpeakerphoneOn(Promise promise) {
        try {
            promise.resolve(audioManager.isSpeakerphoneOn());
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    // ═══════════════════════════════════════
    // VOLUME CONTROL
    // ═══════════════════════════════════════

    /**
     * Set call volume as percentage (0-100)
     */
    @ReactMethod
    public void setCallVolume(int percent) {
        try {
            int maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL);
            int targetVolume = Math.max(0, Math.min(maxVolume,
                    (int) Math.round(maxVolume * percent / 100.0)));
            audioManager.setStreamVolume(AudioManager.STREAM_VOICE_CALL, targetVolume, 0);
            Log.d(TAG, "Call volume: " + percent + "% (" + targetVolume + "/" + maxVolume + ")");
        } catch (Exception e) {
            Log.e(TAG, "Error setting call volume: " + e.getMessage());
        }
    }

    /**
     * Get current call volume as percentage (0-100)
     */
    @ReactMethod
    public void getCallVolume(Promise promise) {
        try {
            int currentVolume = audioManager.getStreamVolume(AudioManager.STREAM_VOICE_CALL);
            int maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL);
            int percent = maxVolume > 0
                    ? (int) Math.round(currentVolume * 100.0 / maxVolume)
                    : 50;
            promise.resolve(percent);
        } catch (Exception e) {
            promise.resolve(50);
        }
    }

    /**
     * Set call volume to maximum
     */
    @ReactMethod
    public void setMaxCallVolume() {
        try {
            int maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL);
            audioManager.setStreamVolume(AudioManager.STREAM_VOICE_CALL, maxVolume, 0);
            Log.d(TAG, "Call volume set to MAX: " + maxVolume);
        } catch (Exception e) {
            Log.e(TAG, "Error setting max volume: " + e.getMessage());
        }
    }

    // ═══════════════════════════════════════
    // VIBRATION
    // ═══════════════════════════════════════

    private void startVibration() {
        try {
            if (vibrator == null || !vibrator.hasVibrator()) return;

            // Pattern: vibrate 1s, pause 1s (loops)
            long[] pattern = {0, 1000, 1000};
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                vibrator.vibrate(pattern, 0);
            }
            Log.d(TAG, "Vibration started");
        } catch (Exception e) {
            Log.e(TAG, "Error starting vibration: " + e.getMessage());
        }
    }

    private void stopVibration() {
        try {
            if (vibrator != null) {
                vibrator.cancel();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error stopping vibration: " + e.getMessage());
        }
    }

    /**
     * Full cleanup — stop all audio/vibration
     */
    @ReactMethod
    public void cleanup() {
        Log.d(TAG, "Full cleanup");
        stopRingtoneInternal();
        stopRingbackInternal();
        stopVibration();
        try {
            audioManager.setMode(AudioManager.MODE_NORMAL);
            audioManager.setSpeakerphoneOn(false);
            audioManager.abandonAudioFocus(null);
        } catch (Exception e) {
            Log.e(TAG, "Cleanup error: " + e.getMessage());
        }
    }
}
