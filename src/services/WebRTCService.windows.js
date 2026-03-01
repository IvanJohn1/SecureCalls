/**
 * WebRTCService.windows.js — Windows stub.
 *
 * react-native-webrtc does not support Windows.
 * Audio/video calls are not available on Windows desktop.
 * All methods return gracefully with warnings.
 */

console.log('[WebRTC] Windows — WebRTC not available');

class WebRTCService {
  constructor() {
    this.callbacks = {};
  }

  async fetchIceServers() {
    console.warn('[WebRTC] Windows — fetchIceServers not available');
    return [];
  }

  async getLocalStream(_isVideo) {
    throw new Error('Audio/video calls are not supported on Windows yet');
  }

  createPeerConnection() {
    throw new Error('WebRTC is not supported on Windows');
  }

  async createOffer() {
    throw new Error('WebRTC is not supported on Windows');
  }

  async createAnswer(_offer) {
    throw new Error('WebRTC is not supported on Windows');
  }

  async setRemoteAnswer(_answer) {}
  async addIceCandidate(_candidate) {}

  switchCamera() {}
  toggleMicrophone(_enabled) {}
  toggleCamera(_enabled) {}

  cleanup() {
    console.log('[WebRTC] Windows — cleanup (no-op)');
  }

  on(event, callback) {
    if (!this.callbacks[event]) this.callbacks[event] = [];
    this.callbacks[event].push(callback);
  }

  off(event, callback) {
    if (!this.callbacks[event]) return;
    const idx = this.callbacks[event].indexOf(callback);
    if (idx > -1) this.callbacks[event].splice(idx, 1);
  }

  _emit(event, data) {
    if (!this.callbacks[event]) return;
    this.callbacks[event].forEach(cb => {
      try { cb(data); } catch (e) {}
    });
  }
}

export default new WebRTCService();
