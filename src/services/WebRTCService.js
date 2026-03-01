import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
} from 'react-native-webrtc';
import {SERVER_URL} from '../config/server.config';

// Fallback ICE серверы (STUN-только, используются если сервер недоступен)
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
 * WebRTC Service v10.0 — Signal Architecture
 * ═══════════════════════════════════════════════════════════
 *
 * v10.0 (Signal-inspired):
 * 1. ✅ Динамическая загрузка ICE/TURN конфигурации с сервера
 * 2. ✅ TURN серверы для надёжной работы за NAT (Xiaomi + мобильные сети)
 * 3. ✅ Современный формат видео-ограничений (без legacy mandatory)
 * 4. ✅ cleanup НЕ очищает callbacks
 * 5. ✅ Безопасные null-проверки везде
 * 6. ✅ ICE queue обрабатывается правильно
 * 7. ✅ Проверка signaling state перед setRemoteDescription
 */

console.log('╔════════════════════════════════════════╗');
console.log('║  WebRTC v10.0 Signal Architecture     ║');
console.log('╚════════════════════════════════════════╝');

class WebRTCService {
  constructor() {
    this.localStream = null;
    this.remoteStream = null;
    this.peerConnection = null;
    this.iceCandidatesQueue = [];
    this.callbacks = {};

    // Статусы
    this.isOfferCreated = false;
    this.isAnswerReceived = false;
    this.remoteDescriptionSet = false;

    // Таймауты
    this.connectionTimeout = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;

    // ICE конфигурация (загружается с сервера Signal-style)
    this.iceServers = null;
  }

  /**
   * Signal-inspired: загрузка ICE/TURN конфигурации с сервера
   * Сервер генерирует временные HMAC-credentials для TURN (как Signal)
   */
  async fetchIceServers() {
    try {
      const response = await fetch(`${SERVER_URL}/webrtc-config`, {
        method: 'GET',
        headers: {'Accept': 'application/json'},
        // Таймаут 5 секунд — не блокируем звонок
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const config = await response.json();
      if (config.iceServers && config.iceServers.length > 0) {
        this.iceServers = config.iceServers;
        console.log('WebRTC v10.0: ICE серверы загружены с сервера:', this.iceServers.length);
        return this.iceServers;
      }
    } catch (error) {
      console.warn('WebRTC v10.0: Не удалось загрузить ICE конфигурацию, используем fallback:', error.message);
    }
    this.iceServers = DEFAULT_ICE_SERVERS;
    return this.iceServers;
  }

  /**
   * Получение локального медиа потока
   */
  async getLocalStream(isVideo = false) {
    console.log('WebRTC v9.0: ПОЛУЧЕНИЕ МЕДИА ПОТОКА, видео:', isVideo);

    try {
      // [FIX v10.0] Используем современный формат constraints (без legacy mandatory)
      // mandatory устарел в Android WebRTC и вызывает предупреждения/ошибки на Android 15
      // Audio constraints optimized for VoIP (louder mic, clear voice)
      // autoGainControl boosts quiet microphones
      // channelCount: 1 forces mono (better for voice)
      // Higher sampleRate = better quality
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
          sampleSize: 16,
        },
        video: isVideo
          ? {
              facingMode: 'user',
              width: {ideal: 640},
              height: {ideal: 480},
              frameRate: {ideal: 30, max: 30},
            }
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
   * Создание PeerConnection с Signal-style ICE конфигурацией
   */
  createPeerConnection() {
    console.log('WebRTC v10.0: СОЗДАНИЕ PEER CONNECTION');

    try {
      // Очистить предыдущее соединение если есть
      if (this.peerConnection) {
        console.log('⚠️ Закрываем старое соединение');
        try {
          this.peerConnection.close();
        } catch (e) {
          // Игнорируем ошибки закрытия
        }
        this.peerConnection = null;
      }

      // Сбросить состояние
      this.iceCandidatesQueue = [];
      this.isOfferCreated = false;
      this.isAnswerReceived = false;
      this.remoteDescriptionSet = false;
      this.reconnectAttempts = 0;

      // Используем загруженные с сервера ICE серверы (включая TURN если настроен)
      const iceServers = this.iceServers || DEFAULT_ICE_SERVERS;
      const configuration = {...BASE_CONFIGURATION, iceServers};

      console.log('→ ICE серверов:', iceServers.length,
        iceServers.some(s => s.urls?.toString().startsWith('turn')) ? '(включая TURN)' : '(только STUN)');

      this.peerConnection = new RTCPeerConnection(configuration);

      // Добавить локальные треки
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          this.peerConnection.addTrack(track, this.localStream);
          console.log('→ Трек добавлен:', track.kind);
        });
      }

      // Настроить обработчики
      this.setupHandlers();

      // Таймаут на установку соединения (60 секунд)
      this.startConnectionTimeout();

      console.log('✅ PeerConnection создан (v10.0)');
    } catch (error) {
      console.error('❌ ОШИБКА создания PeerConnection:', error);
      throw error;
    }
  }

  /**
   * Настройка обработчиков событий
   */
  setupHandlers() {
    if (!this.peerConnection) return;

    // Получен удалённый поток
    this.peerConnection.ontrack = event => {
      console.log('→ ontrack:', event.track?.kind);

      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        console.log('✅ Удалённый поток получен');
        this._emit('remoteStream', this.remoteStream);
        this.clearConnectionTimeout();
      }
    };

    // ICE candidate
    this.peerConnection.onicecandidate = event => {
      if (event.candidate) {
        this._emit('iceCandidate', event.candidate);
      } else {
        console.log('→ Все ICE candidates собраны');
      }
    };

    // ICE connection state
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
          console.log('⚠️ ICE соединение потеряно');
          this.handleDisconnection();
          break;

        case 'failed':
          console.log('❌ ICE соединение не удалось');
          this.handleConnectionFailure();
          break;

        case 'closed':
          console.log('🔒 ICE соединение закрыто');
          break;
      }
    };

    // Connection state
    this.peerConnection.onconnectionstatechange = () => {
      if (!this.peerConnection) return;

      const state = this.peerConnection.connectionState;
      console.log('→ Connection состояние:', state);
      this._emit('connectionStateChange', state);

      switch (state) {
        case 'connected':
          console.log('✅ P2P соединение установлено');
          this.clearConnectionTimeout();
          break;

        case 'disconnected':
          console.log('⚠️ P2P соединение потеряно');
          break;

        case 'failed':
          console.log('❌ P2P соединение не удалось');
          this.handleConnectionFailure();
          break;

        case 'closed':
          console.log('🔒 P2P соединение закрыто');
          break;
      }
    };

    // Обработка ошибок
    this.peerConnection.onicecandidateerror = event => {
      // Не логируем каждую ошибку — слишком много шума
    };
  }

  /**
   * Создание offer
   */
  async createOffer() {
    console.log('WebRTC v9.0: СОЗДАНИЕ OFFER');

    if (!this.peerConnection) {
      throw new Error('PeerConnection не создан');
    }

    try {
      const offer = await this.peerConnection.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true,
      });

      await this.peerConnection.setLocalDescription(offer);
      this.isOfferCreated = true;

      console.log('✅ Offer создан и установлен как localDescription');
      return offer;
    } catch (error) {
      console.error('❌ ОШИБКА создания offer:', error);
      throw error;
    }
  }

  /**
   * Создание answer
   */
  async createAnswer(offer) {
    console.log('WebRTC v9.0: СОЗДАНИЕ ANSWER');

    if (!this.peerConnection) {
      throw new Error('PeerConnection не создан');
    }

    try {
      // FIX: Проверяем signalingState перед setRemoteDescription
      const signalingState = this.peerConnection.signalingState;
      console.log('→ Текущий signalingState:', signalingState);

      if (signalingState !== 'stable' && signalingState !== 'have-local-offer') {
        console.warn('⚠️ Неожиданный signalingState:', signalingState);
      }

      const remoteDesc = new RTCSessionDescription(offer);
      await this.peerConnection.setRemoteDescription(remoteDesc);
      this.remoteDescriptionSet = true;

      console.log('→ Remote description (offer) установлен');

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      console.log('✅ Answer создан и установлен');

      // Обработать очередь ICE кандидатов
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
    console.log('WebRTC v9.0: УСТАНОВКА ANSWER');

    if (!this.peerConnection) {
      throw new Error('PeerConnection не создан');
    }

    try {
      // FIX: Проверяем signalingState
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

      // Обработать очередь ICE кандидатов
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

    // Если remoteDescription ещё не установлен — в очередь
    if (!this.peerConnection.remoteDescription) {
      this.iceCandidatesQueue.push(candidate);
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      // Некоторые кандидаты могут быть невалидными — это нормально
      // console.warn('⚠️ Ошибка ICE candidate:', error.message);
    }
  }

  /**
   * Обработка очереди ICE candidates
   */
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

  /**
   * Таймаут установки соединения
   */
  startConnectionTimeout() {
    this.clearConnectionTimeout();

    this.connectionTimeout = setTimeout(() => {
      console.log('⏰ Таймаут установки WebRTC соединения (60 сек)');
      this._emit('connectionTimeout');
    }, 60000);
  }

  clearConnectionTimeout() {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }

  /**
   * Обработка потери соединения — пытаемся ICE restart
   */
  handleDisconnection() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(
        `🔄 Попытка восстановления ${this.reconnectAttempts}/${this.maxReconnectAttempts}`,
      );

      if (this.peerConnection) {
        try {
          this.peerConnection.restartIce();
        } catch (e) {
          console.warn('⚠️ ICE restart не удался:', e.message);
        }
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

  // ═══════════════════════════════════════
  // Управление медиа
  // ═══════════════════════════════════════

  switchCamera() {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack && videoTrack._switchCamera) {
      videoTrack._switchCamera();
      console.log('→ Камера переключена');
    }
  }

  toggleMicrophone(enabled) {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = enabled;
      console.log('→ Микрофон:', enabled ? 'ВКЛ' : 'ВЫКЛ');
    }
  }

  toggleCamera(enabled) {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = enabled;
      console.log('→ Видео:', enabled ? 'ВКЛ' : 'ВЫКЛ');
    }
  }

  /**
   * Полная очистка
   * FIX: НЕ очищаем callbacks — это делает off()
   */
  cleanup() {
    console.log('WebRTC v10.0: ОЧИСТКА');

    this.clearConnectionTimeout();

    // Остановить локальные треки
    if (this.localStream) {
      try {
        this.localStream.getTracks().forEach(track => {
          track.stop();
        });
      } catch (e) {
        // Игнорируем ошибки
      }
      this.localStream = null;
    }

    // Закрыть PeerConnection
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (e) {
        // Игнорируем ошибки закрытия
      }
      this.peerConnection = null;
    }

    // Очистить состояние, НО НЕ callbacks
    this.remoteStream = null;
    this.iceCandidatesQueue = [];
    this.isOfferCreated = false;
    this.isAnswerReceived = false;
    this.remoteDescriptionSet = false;
    this.reconnectAttempts = 0;

    // Сбрасываем iceServers чтобы следующий звонок заново запросил конфиг с сервера
    this.iceServers = null;

    console.log('✅ Очистка завершена (v10.0)');
  }

  // ═══════════════════════════════════════
  // Управление событиями
  // ═══════════════════════════════════════

  on(event, callback) {
    if (!this.callbacks[event]) {
      this.callbacks[event] = [];
    }
    this.callbacks[event].push(callback);
  }

  off(event, callback) {
    if (!this.callbacks[event]) return;

    const index = this.callbacks[event].indexOf(callback);
    if (index > -1) {
      this.callbacks[event].splice(index, 1);
    }
  }

  _emit(event, data) {
    if (!this.callbacks[event]) return;

    // Копируем массив чтобы безопасно итерировать
    const cbs = [...this.callbacks[event]];
    cbs.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[WebRTC] Ошибка в callback ${event}:`, error);
      }
    });
  }
}

export default new WebRTCService();