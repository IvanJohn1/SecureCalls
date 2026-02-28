import {NativeModules, Platform} from 'react-native';

const {AudioModule} = NativeModules;

/**
 * AudioService — JS wrapper for native AudioModule
 *
 * Provides:
 * - Ringtone playback for incoming calls
 * - Ringback tone for outgoing calls
 * - Speakerphone toggle
 * - Audio mode management (MODE_IN_COMMUNICATION)
 * - Call volume control
 */
class AudioService {
  constructor() {
    this._available = Platform.OS === 'android' && !!AudioModule;
    if (!this._available) {
      console.log('[AudioService] Native AudioModule not available on', Platform.OS);
    }
  }

  // ═══════════════════════════════════════
  // RINGTONE — incoming call
  // ═══════════════════════════════════════

  startRingtone() {
    if (this._available) {
      AudioModule.startRingtone();
    }
  }

  stopRingtone() {
    if (this._available) {
      AudioModule.stopRingtone();
    }
  }

  // ═══════════════════════════════════════
  // RINGBACK — outgoing call
  // ═══════════════════════════════════════

  startRingback() {
    if (this._available) {
      AudioModule.startRingback();
    }
  }

  stopRingback() {
    if (this._available) {
      AudioModule.stopRingback();
    }
  }

  // ═══════════════════════════════════════
  // AUDIO MODE
  // ═══════════════════════════════════════

  /**
   * Set MODE_IN_COMMUNICATION — MUST be called when call connects.
   * Without this, microphone is too quiet and audio routes incorrectly.
   */
  setCallMode() {
    if (this._available) {
      AudioModule.setAudioModeInCall();
    }
  }

  setNormalMode() {
    if (this._available) {
      AudioModule.setAudioModeNormal();
    }
  }

  // ═══════════════════════════════════════
  // SPEAKERPHONE
  // ═══════════════════════════════════════

  setSpeaker(enabled) {
    if (this._available) {
      AudioModule.setSpeakerphone(enabled);
    }
  }

  async isSpeakerOn() {
    if (this._available) {
      try {
        return await AudioModule.isSpeakerphoneOn();
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  // ═══════════════════════════════════════
  // VOLUME
  // ═══════════════════════════════════════

  /**
   * Set call volume (0-100 percent)
   */
  setVolume(percent) {
    if (this._available) {
      AudioModule.setCallVolume(Math.round(Math.max(0, Math.min(100, percent))));
    }
  }

  async getVolume() {
    if (this._available) {
      try {
        return await AudioModule.getCallVolume();
      } catch (e) {
        return 50;
      }
    }
    return 50;
  }

  setMaxVolume() {
    if (this._available) {
      AudioModule.setMaxCallVolume();
    }
  }

  // ═══════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════

  cleanup() {
    if (this._available) {
      AudioModule.cleanup();
    }
  }
}

export default new AudioService();
