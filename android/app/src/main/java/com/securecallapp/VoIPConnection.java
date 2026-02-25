package com.securecallapp;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.telecom.Connection;
import android.telecom.DisconnectCause;
import android.util.Log;

import androidx.annotation.RequiresApi;

/**
 * VoIPConnection — represents a single VoIP call within the Android Telecom framework.
 *
 * This is the same approach used by Signal, WhatsApp, and Telegram.
 * When registered with TelecomManager via CAPABILITY_SELF_MANAGED:
 *  - Samsung Freecess will NOT freeze the process during an active/ringing call
 *  - The app gets elevated process priority (oom_score_adj is lowered)
 *  - WakeLocks are not stripped while the call is active
 *
 * Lifecycle:
 *  1. Created in RINGING state by VoIPConnectionService.onCreateIncomingConnection()
 *  2. User answers → onAnswer() → set ACTIVE → launch MainActivity
 *  3. User rejects → onReject() → set DISCONNECTED → destroy
 *  4. Call ends → onDisconnect() → cleanup
 */
@RequiresApi(api = Build.VERSION_CODES.O)
public class VoIPConnection extends Connection {
    private static final String TAG = "VoIPConnection";

    private final Context context;
    private final String from;
    private final String callId;
    private final boolean isVideo;

    public VoIPConnection(Context context, String from, String callId, boolean isVideo) {
        this.context = context;
        this.from = from;
        this.callId = callId;
        this.isVideo = isVideo;

        // Self-managed: app handles its own UI
        setConnectionProperties(PROPERTY_SELF_MANAGED);
        setConnectionCapabilities(CAPABILITY_HOLD | CAPABILITY_SUPPORT_HOLD);
        setAudioModeIsVoip(true);
    }

    @Override
    public void onAnswer() {
        Log.d(TAG, "onAnswer — call from: " + from + " callId: " + callId);
        setActive();

        // Launch MainActivity with incoming call data
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                Intent.FLAG_ACTIVITY_CLEAR_TOP |
                Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("type", "incoming_call");
        intent.putExtra("from", from);
        intent.putExtra("callId", callId);
        intent.putExtra("isVideo", String.valueOf(isVideo));
        intent.putExtra("answeredViaTelecom", true);
        context.startActivity(intent);
    }

    @Override
    public void onReject() {
        Log.d(TAG, "onReject — call from: " + from);
        setDisconnected(new DisconnectCause(DisconnectCause.REJECTED));
        destroy();
        VoIPConnectionService.clearActiveConnection();
    }

    @Override
    public void onDisconnect() {
        Log.d(TAG, "onDisconnect — call from: " + from);
        setDisconnected(new DisconnectCause(DisconnectCause.LOCAL));
        destroy();
        VoIPConnectionService.clearActiveConnection();
    }

    @Override
    public void onAbort() {
        Log.d(TAG, "onAbort — call from: " + from);
        setDisconnected(new DisconnectCause(DisconnectCause.CANCELED));
        destroy();
        VoIPConnectionService.clearActiveConnection();
    }

    /**
     * Called by JS when the call has been properly accepted via socket
     */
    public void setCallActive() {
        if (getState() != STATE_ACTIVE) {
            setActive();
        }
    }

    /**
     * Called by JS to end the call
     */
    public void endCall() {
        setDisconnected(new DisconnectCause(DisconnectCause.LOCAL));
        destroy();
        VoIPConnectionService.clearActiveConnection();
    }

    public String getFrom() { return from; }
    public String getCallId() { return callId; }
    public boolean getIsVideo() { return isVideo; }
}
