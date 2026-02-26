package com.securecallapp;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.telecom.Connection;
import android.telecom.DisconnectCause;
import android.util.Log;

import androidx.annotation.RequiresApi;

/**
 * VoIPConnection v2.0 — представляет один VoIP-звонок в Android Telecom.
 *
 * ДОБАВЛЕНО v2.0:
 * ─────────────────────────────────────────────────────────────
 * Поддержка исходящих звонков (isOutgoing = true).
 *
 * ПРОБЛЕМА (до v2.0):
 * Конструктор не принимал флаг isOutgoing. VoIPConnectionService
 * не мог различить входящий и исходящий звонок.
 *
 * РЕШЕНИЕ:
 * Добавлен параметр isOutgoing в конструктор.
 * Добавлен setCallActive() для перевода исходящего звонка в ACTIVE
 * когда удалённая сторона приняла звонок (вызывается из ConnectionServiceModule).
 * ─────────────────────────────────────────────────────────────
 *
 * Жизненный цикл входящего звонка (без изменений):
 *  1. RINGING → onAnswer() → ACTIVE → onDisconnect() → DISCONNECTED
 *
 * Жизненный цикл исходящего звонка (NEW v2.0):
 *  1. DIALING (установлен в VoIPConnectionService)
 *  2. Удалённая сторона ответила → JS вызывает ConnectionService.setOutgoingCallActive()
 *     → setCallActive() → ACTIVE
 *  3. Звонок завершён → endCall() → DISCONNECTED
 */
@RequiresApi(api = Build.VERSION_CODES.O)
public class VoIPConnection extends Connection {
    private static final String TAG = "VoIPConnection";

    private final Context context;
    private final String from;       // для входящих: кто звонит; для исходящих: кому звоним
    private final String callId;
    private final boolean isVideo;
    private final boolean isOutgoing; // NEW v2.0

    public VoIPConnection(Context context, String from, String callId,
                          boolean isVideo, boolean isOutgoing) {
        this.context = context;
        this.from = from;
        this.callId = callId;
        this.isVideo = isVideo;
        this.isOutgoing = isOutgoing;

        setConnectionProperties(PROPERTY_SELF_MANAGED);
        setConnectionCapabilities(CAPABILITY_HOLD | CAPABILITY_SUPPORT_HOLD);
        setAudioModeIsVoip(true);
    }

    // ─────────────────────────────────────────────────────────
    // ВХОДЯЩИЕ ЗВОНКИ
    // ─────────────────────────────────────────────────────────

    @Override
    public void onAnswer() {
        Log.d(TAG, "onAnswer — call from: " + from + " callId: " + callId);
        setActive();

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

    // ─────────────────────────────────────────────────────────
    // ОБЩИЕ (входящие + исходящие)
    // ─────────────────────────────────────────────────────────

    @Override
    public void onDisconnect() {
        Log.d(TAG, "onDisconnect — from: " + from + " isOutgoing: " + isOutgoing);
        setDisconnected(new DisconnectCause(DisconnectCause.LOCAL));
        destroy();
        VoIPConnectionService.clearActiveConnection();
    }

    @Override
    public void onAbort() {
        Log.d(TAG, "onAbort — from: " + from);
        setDisconnected(new DisconnectCause(DisconnectCause.CANCELED));
        destroy();
        VoIPConnectionService.clearActiveConnection();
    }

    /**
     * Перевод звонка в ACTIVE.
     * Для входящих: вызывается когда JS принял звонок через сокет.
     * Для исходящих: вызывается когда удалённая сторона ответила
     *   (ConnectionServiceModule.setOutgoingCallActive() из JS CallScreen).
     */
    public void setCallActive() {
        if (getState() != STATE_ACTIVE) {
            setActive();
            Log.d(TAG, "Connection set ACTIVE: from=" + from + " isOutgoing=" + isOutgoing);
        }
    }

    /**
     * Завершить звонок (вызывается из JS).
     */
    public void endCall() {
        setDisconnected(new DisconnectCause(DisconnectCause.LOCAL));
        destroy();
        VoIPConnectionService.clearActiveConnection();
        Log.d(TAG, "Call ended: from=" + from + " isOutgoing=" + isOutgoing);
    }

    public String getFrom() { return from; }
    public String getCallId() { return callId; }
    public boolean getIsVideo() { return isVideo; }
    public boolean getIsOutgoing() { return isOutgoing; }
}
