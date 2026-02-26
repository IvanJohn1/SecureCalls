import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
} from 'react-native-webrtc';
import {SERVER_URL} from '../config/server.config';

const DEFAULT_ICE_SERVERS = [
  {urls: 'stun:stun.l.google.com:19302'},
  {urls: 'stun:stun1.l.google.com:19302'},
  {urls: 'stun:stun2.l.google.com:19302'},
];

const BASE_CONFIGURATION = {
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

/**
 * ═══════════════════════════════════════════════════════════
 * WebRTC Service v10.2 — Glare Condition Fix
 * ═══════════════════════════════════════════════════════════
 *
 * v10.2 fix:
 * ─────────────────────────────────────────────────────────
 * БАГ: createAnswer() при signalingState='have-local-offer' просто
 *      выводил console.warn, затем падал с InvalidStateError на
 *      setRemoteDescription() — звонок подвисал молча.
 *
 *      Сценарий: glare condition — два пользователя одновременно
 *      инициируют звонок друг другу. Один получает offer пока сам
 *      находится в состоянии 'have-local-offer'.
 *
 * ФИКС: RFC 8829 — при 'have-local-offer' выполняем rollback
 *   await setLocalDescription({type: 'rollback'})
 *   Это отменяет pending offer, возвращает 'stable',
 *   после чего setRemoteDescription(offer) проходит нормально.
 * ─────────────────────────────────────────────────────────
 *
 * v10.1: AbortController для реального таймаута fetchIceServers.
 * v10.0: Signal-inspired dynamic ICE/TURN loading.
 */

console.log('╔════════════════════════════════════════╗');
console.log('║  WebRTC v10.2 Glare Fix               ║');
console.log('╚════════════════════════════════════════╝');

class WebRTCService {
  constructor() {
    this.localStream = null;
    this.remoteStream = null;
    this.peerConnection = null;
    this.iceCandidatesQueue = [];
    this.callbacks = {};

    this.isOfferCreated = false;
    this.isAnswerReceived = false;
    this.remoteDescriptionSet = false;

    this.connectionTimeout = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;

    this.iceServers = null;
  }

  /**
   * Загрузка ICE/TURN конфигурации с сервера.
   * AbortController обеспечивает реальный 5-секундный таймаут.
   */
  async fetchIceServers() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${SERVER_URL}/webrtc-config`, {
        method: 'GET',
        headers: {'Accept': 'application/json'},
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const config = await response.json();
      if (config.iceServers && config.iceServers.length > 0) {
        this.iceServers = config.iceServers;
        console.log('[WebRTC v10.2] ✅ ICE серверы загружены:', this.iceServers.length);
        return this.iceServers;
      }

      throw new Error('Пустой список ICE серверов');
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        console.warn('[WebRTC v10.2] ⏰ Таймаут ICE конфигурации (5s) — используем fallback');
      } else {
        console.warn('[WebRTC v10.2] ⚠️ ICE config error:', error.message, '— fallback');
      }

      this.iceServers = DEFAULT_ICE_SERVERS;
      return this.iceServers;
    }
  }

  /**
   * Получение локального медиа потока
   */
  async getLocalStream(isVideo = false) {
    console.log('[WebRTC v10.2] ПОЛУЧЕНИЕ МЕДИА ПОТОКА, видео:', isVideo);

    try {
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        },
        video: isVideo
          ? {facingMode: 'user', width: {ideal: 640}, height: {ideal: 480}, frameRate: {ideal: 30, max: 30}}
          : false,
      };

      this.localStream = await mediaDevices.getUserMedia(constraints);

      console.log('✅ Медиа поток получен');
      console.log('  Аудио треков:', this.localStream.getAudioTracks().length);
      console.log('  Видео треков:', this.localStream.getVideoTracks().length);

      this._emit('localStream', this.localStream);
      return this.localStream;
    } catch (error) {
      console.error('❌ ОШИБКА получения медиа потока:', error);
      throw error;
    }
  }

  /**
   * Создание PeerConnection
   */
  createPeerConnection() {
    console.log('[WebRTC v10.2] СОЗДАНИЕ PEER CONNECTION');

    try {
      if (this.peerConnection) {
        console.log('⚠️ Закрываем старое соединение');
        try { this.peerConnection.close(); } catch (e) {}
        this.peerConnection = null;
      }

      this.iceCandidatesQueue = [];
      this.isOfferCreated = false;
      this.isAnswerReceived = false;
      this.remoteDescriptionSet = false;
      this.reconnectAttempts = 0;

      const iceServers = this.iceServers || DEFAULT_ICE_SERVERS;
      const configuration = {...BASE_CONFIGURATION, iceServers};

      console.log('→ ICE серверов:', iceServers.length,
        iceServers.some(s => s.urls?.toString().startsWith('turn')) ? '(включая TURN)' : '(только STUN)');

      this.peerConnection = new RTCPeerConnection(configuration);

      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          this.peerConnection.addTrack(track, this.localStream);
          console.log('→ Трек добавлен:', track.kind);
        });
      }

      this.setupHandlers();
      this.startConnectionTimeout();

      console.log('✅ PeerConnection создан (v10.2)');
    } catch (error) {
      console.error('❌ ОШИБКА создания PeerConnection:', error);
      throw error;
    }
  }

  setupHandlers() {
    if (!this.peerConnection) return;

    this.peerConnection.ontrack = event => {
      console.log('→ ontrack:', event.track?.kind);
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        console.log('✅ Удалённый поток получен');
        this._emit('remoteStream', this.remoteStream);
        this.clearConnectionTimeout();
      }
    };

    this.peerConnection.onicecandidate = event => {
      if (event.candidate) {
        this._emit('iceCandidate', event.candidate);
      } else {
        console.log('→ Все ICE candidates собраны');
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      if (!this.peerConnection) return;
      const state = this.peerConnection.iceConnectionState;
      console.log('→ ICE состояние:', state);
      this._emit('iceConnectionStateChange', state);

      switch (state) {
        case 'connected':
        case 'completed':
          console.log('✅ ICE соединение установлено');
          this.reconnectAttempts = 0;
          this.clearConnectionTimeout();
          break;
        case 'disconnected':
          this.handleDisconnection();
          break;
        case 'failed':
          this.handleConnectionFailure();
          break;
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (!this.peerConnection) return;
      const state = this.peerConnection.connectionState;
      console.log('→ Connection состояние:', state);
      this._emit('connectionStateChange', state);

      if (state === 'connected') {
        this.clearConnectionTimeout();
      } else if (state === 'failed') {
        this.handleConnectionFailure();
      }
    };

    this.peerConnection.onicecandidateerror = () => {};
  }

  /**
   * Создание offer
   */
  async createOffer() {
    console.log('[WebRTC v10.2] СОЗДАНИЕ OFFER');

    if (!this.peerConnection) throw new Error('PeerConnection не создан');

    try {
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await this.peerConnection.setLocalDescription(offer);
      this.isOfferCreated = true;
      console.log('✅ Offer создан и установлен');
      return offer;
    } catch (error) {
      console.error('❌ ОШИБКА создания offer:', error);
      throw error;
    }
  }

  /**
   * Создание answer — с обработкой glare condition (RFC 8829).
   *
   * [FIX v10.2] Glare condition: оба пользователя одновременно звонят.
   * Один получает входящий offer пока сам в состоянии 'have-local-offer'.
   * setRemoteDescription() в этом состоянии бросает InvalidStateError.
   *
   * РЕШЕНИЕ (RFC 8829, раздел 5.2):
   *   Откатываем наш pending offer через setLocalDescription({type: 'rollback'}).
   *   Это возвращает signalingState → 'stable'.
   *   Теперь setRemoteDescription(incomingOffer) работает корректно.
   *   Мы становимся callee, удалённая сторона — caller.
   */
  async createAnswer(offer) {
    console.log('[WebRTC v10.2] СОЗДАНИЕ ANSWER');

    if (!this.peerConnection) throw new Error('PeerConnection не создан');

    try {
      const signalingState = this.peerConnection.signalingState;
      console.log('→ Текущий signalingState:', signalingState);

      // [FIX v10.2] Glare condition — откатываем наш pending offer
      if (signalingState === 'have-local-offer') {
        console.warn('⚠️ Glare condition: have-local-offer, выполняем rollback (RFC 8829)');
        try {
          await this.peerConnection.setLocalDescription({type: 'rollback'});
          console.log('→ Rollback выполнен, signalingState:', this.peerConnection.signalingState);
        } catch (rollbackError) {
          console.error('❌ Rollback failed:', rollbackError.message);
          throw rollbackError;
        }
      } else if (signalingState !== 'stable') {
        // Другое неожиданное состояние — логируем, но пробуем продолжить
        console.warn('⚠️ Неожиданный signalingState перед setRemoteDescription:', signalingState);
      }

      const remoteDesc = new RTCSessionDescription(offer);
      await this.peerConnection.setRemoteDescription(remoteDesc);
      this.remoteDescriptionSet = true;
      console.log('→ Remote description (offer) установлен');

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      console.log('✅ Answer создан и установлен');

      await this._processIceCandidatesQueue();
      return answer;
    } catch (error) {
      console.error('❌ ОШИБКА создания answer:', error);
      throw error;
    }
  }

  /**
   * Установка удалённого answer
   */
  async setRemoteAnswer(answer) {
    console.log('[WebRTC v10.2] УСТАНОВКА ANSWER');

    if (!this.peerConnection) throw new Error('PeerConnection не создан');

    try {
      const signalingState = this.peerConnection.signalingState;
      console.log('→ Текущий signalingState:', signalingState);

      if (signalingState !== 'have-local-offer') {
        console.warn('⚠️ Ожидался have-local-offer, получен:', signalingState);
        if (signalingState === 'stable') {
          console.log('→ Уже stable, пропускаем setRemoteDescription');
          return;
        }
      }

      const remoteDesc = new RTCSessionDescription(answer);
      await this.peerConnection.setRemoteDescription(remoteDesc);
      this.remoteDescriptionSet = true;
      this.isAnswerReceived = true;
      console.log('✅ Answer установлен как remoteDescription');

      await this._processIceCandidatesQueue();
    } catch (error) {
      console.error('❌ ОШИБКА установки answer:', error);
      throw error;
    }
  }

  /**
   * Добавление ICE candidate
   */
  async addIceCandidate(candidate) {
    if (!this.peerConnection) {
      console.warn('⚠️ PeerConnection не создан, ICE candidate пропущен');
      return;
    }

    if (!this.peerConnection.remoteDescription) {
      this.iceCandidatesQueue.push(candidate);
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      // Некоторые кандидаты могут быть невалидными — это нормально
    }
  }

  async _processIceCandidatesQueue() {
    if (this.iceCandidatesQueue.length === 0) return;
    console.log(`→ Обработка ${this.iceCandidatesQueue.length} ICE candidates из очереди`);

    const candidates = [...this.iceCandidatesQueue];
    this.iceCandidatesQueue = [];

    for (const candidate of candidates) {
      await this.addIceCandidate(candidate);
    }

    console.log('✅ Очередь ICE candidates обработана');
  }

  startConnectionTimeout() {
    this.clearConnectionTimeout();
    this.connectionTimeout = setTimeout(() => {
      console.log('⏰ Таймаут WebRTC соединения (60 сек)');
      this._emit('connectionTimeout');
    }, 60000);
  }

  clearConnectionTimeout() {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }

  handleDisconnection() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Попытка восстановления ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      if (this.peerConnection) {
        try { this.peerConnection.restartIce(); } catch (e) {}
      }
    } else {
      console.log('❌ Превышено количество попыток восстановления');
      this._emit('connectionStateChange', 'failed');
    }
  }

  handleConnectionFailure() {
    this.clearConnectionTimeout();
    this._emit('connectionFailed');
  }

  switchCamera() {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack && videoTrack._switchCamera) {
      videoTrack._switchCamera();
    }
  }

  toggleMicrophone(enabled) {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = enabled;
  }

  toggleCamera(enabled) {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) videoTrack.enabled = enabled;
  }

  /**
   * Полная очистка. НЕ очищаем callbacks — это делает off().
   */
  cleanup() {
    console.log('[WebRTC v10.2] ОЧИСТКА');
    this.clearConnectionTimeout();

    if (this.localStream) {
      try { this.localStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      this.localStream = null;
    }

    if (this.peerConnection) {
      try { this.peerConnection.close(); } catch (e) {}
      this.peerConnection = null;
    }

    this.remoteStream = null;
    this.iceCandidatesQueue = [];
    this.isOfferCreated = false;
    this.isAnswerReceived = false;
    this.remoteDescriptionSet = false;
    this.reconnectAttempts = 0;
    this.iceServers = null;

    console.log('✅ Очистка завершена (v10.2)');
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
    const cbs = [...this.callbacks[event]];
    cbs.forEach(cb => {
      try { cb(data); } catch (e) {
        console.error(`[WebRTC] Ошибка в callback ${event}:`, e);
      }
    });
  }
}

export default new WebRTCService();
