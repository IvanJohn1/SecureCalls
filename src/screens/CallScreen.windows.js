import React, {useState, useEffect, useRef, useCallback} from 'react';
import {View, StyleSheet, StatusBar, Alert} from 'react-native';
import {WebView} from 'react-native-webview';
import SocketService from '../services/SocketService';
import NotificationService from '../services/NotificationService.windows';
import {SERVER_URL} from '../config/server.config';

console.log('[CallScreen.windows.js] LOADED — WebView WebRTC version');

/**
 * CallScreen.windows.js — Windows Desktop (WebView2 WebRTC)
 *
 * react-native-webrtc does not support Windows, so we use
 * WebView2 (Chromium-based) which has full WebRTC support.
 *
 * Architecture:
 *  RN layer  — Socket.IO signaling + call lifecycle
 *  WebView   — getUserMedia + RTCPeerConnection + video display + controls UI
 *  Bridge    — postMessage in both directions
 */

function getCallHTML(peer, isVideo, isCaller) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1a1a1a;color:#fff;font-family:Segoe UI,sans-serif;overflow:hidden;height:100vh;width:100vw}
#app{display:flex;flex-direction:column;height:100vh}
#videoArea{flex:1;position:relative;display:flex;justify-content:center;align-items:center}
#remoteVideo{width:100%;height:100%;object-fit:cover;display:none}
#localVideo{position:absolute;top:16px;right:16px;width:160px;height:120px;object-fit:cover;border-radius:8px;border:2px solid #fff;display:none;z-index:10}
.avatar{width:150px;height:150px;border-radius:50%;background:#667eea;display:flex;justify-content:center;align-items:center;margin-bottom:24px}
.avatar-text{font-size:60px;font-weight:bold;color:#fff}
.info{text-align:center;position:absolute;top:40px;left:0;right:0;z-index:5}
.peer-name{font-size:28px;font-weight:bold;text-shadow:0 1px 4px rgba(0,0,0,.7)}
.call-status{font-size:16px;color:rgba(255,255,255,.8);margin-top:6px;text-shadow:0 1px 4px rgba(0,0,0,.7)}
.center-info{text-align:center}
#controls{display:flex;justify-content:center;gap:20px;padding:24px 16px 40px;z-index:10}
.ctrl-btn{width:64px;height:64px;border-radius:50%;border:none;cursor:pointer;display:flex;flex-direction:column;justify-content:center;align-items:center;color:#fff;font-size:12px;transition:opacity .2s}
.ctrl-btn:hover{opacity:.85}
.ctrl-btn .icon{font-size:24px;margin-bottom:2px}
.ctrl-btn .label{font-size:10px;font-weight:500}
.btn-mute{background:rgba(255,255,255,.2)}
.btn-mute.active{background:rgba(255,59,48,.8)}
.btn-video{background:rgba(255,255,255,.2)}
.btn-video.active{background:rgba(255,59,48,.8)}
.btn-end{background:rgba(255,59,48,.9)}
</style></head><body>
<div id="app">
  <div id="videoArea">
    <video id="remoteVideo" autoplay playsinline></video>
    <video id="localVideo" autoplay playsinline muted></video>
    <div id="avatarBlock" class="center-info">
      <div class="avatar"><span class="avatar-text">${peer.substring(0, 2).toUpperCase()}</span></div>
    </div>
    <div class="info">
      <div class="peer-name">${peer}</div>
      <div class="call-status" id="statusText">Инициализация...</div>
    </div>
  </div>
  <div id="controls">
    <button class="ctrl-btn btn-mute" id="btnMute" onclick="toggleMute()">
      <span class="icon" id="muteIcon">&#x1F3A4;</span>
      <span class="label" id="muteLabel">Микрофон</span>
    </button>
    ${isVideo ? `
    <button class="ctrl-btn btn-video" id="btnVideo" onclick="toggleVideo()">
      <span class="icon" id="videoIcon">&#x1F4F9;</span>
      <span class="label" id="videoLabel">Камера</span>
    </button>` : ''}
    <button class="ctrl-btn btn-end" onclick="endCall()">
      <span class="icon">&#x274C;</span>
      <span class="label">Завершить</span>
    </button>
  </div>
</div>
<script>
const IS_VIDEO = ${isVideo ? 'true' : 'false'};
const IS_CALLER = ${isCaller ? 'true' : 'false'};
let pc = null;
let localStream = null;
let remoteStream = null;
let isMuted = false;
let isVideoOn = true;
let iceServers = [{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}];
let iceCandidateQueue = [];
let remoteDescSet = false;
let offerSent = false;
let answerSent = false;

function sendToRN(msg) {
  try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch(e) {}
}
function setStatus(t) {
  var el = document.getElementById('statusText');
  if (el) el.textContent = t;
}

async function init(config) {
  try {
    if (config && config.iceServers && config.iceServers.length > 0) {
      iceServers = config.iceServers;
    }
    setStatus('Доступ к медиа...');
    var constraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
    if (IS_VIDEO) constraints.video = { facingMode: 'user', width: {ideal:640}, height: {ideal:480}, frameRate: {ideal:30} };
    else constraints.video = false;
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (IS_VIDEO) {
      var lv = document.getElementById('localVideo');
      lv.srcObject = localStream;
      lv.style.display = 'block';
    }
    createPC();
    sendToRN({type:'mediaReady'});
    if (IS_CALLER) setStatus('Вызов...');
    else setStatus('Соединение...');
  } catch(e) {
    setStatus('Ошибка: ' + e.message);
    sendToRN({type:'error', message: e.message});
  }
}

function createPC() {
  if (pc) { try{pc.close();}catch(e){} }
  iceCandidateQueue = [];
  remoteDescSet = false;
  offerSent = false;
  answerSent = false;
  pc = new RTCPeerConnection({ iceServers: iceServers, iceCandidatePoolSize: 10, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
  if (localStream) {
    localStream.getTracks().forEach(function(t) { pc.addTrack(t, localStream); });
  }
  pc.ontrack = function(e) {
    if (e.streams && e.streams[0]) {
      remoteStream = e.streams[0];
      var rv = document.getElementById('remoteVideo');
      rv.srcObject = remoteStream;
      rv.style.display = 'block';
      if (!IS_VIDEO) rv.style.display = 'none';
      document.getElementById('avatarBlock').style.display = IS_VIDEO ? 'none' : 'flex';
      sendToRN({type:'remoteStream'});
    }
  };
  pc.onicecandidate = function(e) {
    if (e.candidate) sendToRN({type:'iceCandidate', candidate: e.candidate});
  };
  pc.oniceconnectionstatechange = function() {
    if (!pc) return;
    var s = pc.iceConnectionState;
    sendToRN({type:'iceState', state: s});
    if (s === 'connected' || s === 'completed') sendToRN({type:'connected'});
    if (s === 'failed') sendToRN({type:'connectionFailed'});
    if (s === 'disconnected') sendToRN({type:'disconnected'});
  };
  pc.onconnectionstatechange = function() {
    if (!pc) return;
    var s = pc.connectionState;
    if (s === 'connected') sendToRN({type:'connected'});
    if (s === 'failed') sendToRN({type:'connectionFailed'});
  };
}

async function createOffer() {
  if (!pc || offerSent) return;
  try {
    offerSent = true;
    setStatus('Соединение...');
    var offer = await pc.createOffer({offerToReceiveAudio:true, offerToReceiveVideo:true});
    await pc.setLocalDescription(offer);
    sendToRN({type:'offer', offer: offer});
  } catch(e) {
    offerSent = false;
    sendToRN({type:'error', message:'Offer error: ' + e.message});
  }
}

async function handleOffer(offer) {
  if (!pc || answerSent) return;
  try {
    answerSent = true;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    remoteDescSet = true;
    var answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendToRN({type:'answer', answer: answer});
    processIceQueue();
  } catch(e) {
    answerSent = false;
    sendToRN({type:'error', message:'Answer error: ' + e.message});
  }
}

async function handleAnswer(answer) {
  if (!pc) return;
  try {
    if (pc.signalingState === 'stable') return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    remoteDescSet = true;
    processIceQueue();
  } catch(e) {
    sendToRN({type:'error', message:'Answer set error: ' + e.message});
  }
}

async function addIce(candidate) {
  if (!pc) return;
  if (!remoteDescSet) { iceCandidateQueue.push(candidate); return; }
  try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e) {}
}

function processIceQueue() {
  while (iceCandidateQueue.length > 0) {
    var c = iceCandidateQueue.shift();
    try { pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
  }
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(function(t) { t.enabled = !isMuted; });
  var btn = document.getElementById('btnMute');
  var icon = document.getElementById('muteIcon');
  var label = document.getElementById('muteLabel');
  if (isMuted) { btn.classList.add('active'); icon.innerHTML='&#x1F507;'; label.textContent='Вкл. звук'; }
  else { btn.classList.remove('active'); icon.innerHTML='&#x1F3A4;'; label.textContent='Микрофон'; }
  sendToRN({type:'muteChanged', muted: isMuted});
}

function toggleVideo() {
  if (!localStream || !IS_VIDEO) return;
  isVideoOn = !isVideoOn;
  localStream.getVideoTracks().forEach(function(t) { t.enabled = isVideoOn; });
  var btn = document.getElementById('btnVideo');
  var lv = document.getElementById('localVideo');
  if (!isVideoOn) { btn.classList.add('active'); lv.style.display='none'; }
  else { btn.classList.remove('active'); lv.style.display='block'; }
}

function endCall() {
  sendToRN({type:'endCall'});
}

function cleanup() {
  if (localStream) { localStream.getTracks().forEach(function(t){t.stop();}); localStream = null; }
  if (pc) { try{pc.close();}catch(e){} pc = null; }
}

function updateDuration(sec) {
  var m = Math.floor(sec/60);
  var s = sec % 60;
  setStatus((m<10?'0':'')+m+':'+(s<10?'0':'')+s);
}

// Listen for messages from React Native
document.addEventListener('message', function(e) { handleMsg(e.data); });
window.addEventListener('message', function(e) { handleMsg(e.data); });

function handleMsg(raw) {
  try {
    var msg = JSON.parse(raw);
    switch(msg.type) {
      case 'init': init(msg.config); break;
      case 'createOffer': createOffer(); break;
      case 'handleOffer': handleOffer(msg.offer); break;
      case 'handleAnswer': handleAnswer(msg.answer); break;
      case 'addIceCandidate': addIce(msg.candidate); break;
      case 'updateDuration': updateDuration(msg.seconds); break;
      case 'setStatus': setStatus(msg.text); break;
      case 'cleanup': cleanup(); break;
    }
  } catch(e) {}
}

sendToRN({type:'ready'});
</script></body></html>`;
}

export default function CallScreen({route, navigation}) {
  const {username, peer, isVideo, isCaller, offer, callId: initialCallId} = route.params;

  const webViewRef = useRef(null);
  const callTimerRef = useRef(null);
  const callTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);
  const isCleanedUpRef = useRef(false);
  const callIdRef = useRef(initialCallId || null);
  const callStateRef = useRef('initializing');
  const offerSentRef = useRef(false);
  const answerSentRef = useRef(false);
  const webViewReady = useRef(false);
  const pendingMessages = useRef([]);
  const [callDuration, setCallDuration] = useState(0);

  const sendToWebView = useCallback((msg) => {
    const json = JSON.stringify(msg);
    if (webViewReady.current && webViewRef.current) {
      webViewRef.current.postMessage(json);
    } else {
      pendingMessages.current.push(json);
    }
  }, []);

  const flushPendingMessages = useCallback(() => {
    if (webViewRef.current) {
      pendingMessages.current.forEach(msg => {
        webViewRef.current.postMessage(msg);
      });
      pendingMessages.current = [];
    }
  }, []);

  // ============================================
  // Lifecycle
  // ============================================

  useEffect(() => {
    isMountedRef.current = true;
    isCleanedUpRef.current = false;

    NotificationService.cancelAllNotifications();
    setupSocketListeners();

    if (isCaller) {
      callTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        Alert.alert('Нет ответа', 'Собеседник не отвечает', [
          {text: 'OK', onPress: handleEndCall},
        ]);
      }, 60000);
    }

    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, []);

  // ============================================
  // Socket listeners
  // ============================================

  const setupSocketListeners = () => {
    SocketService.on('call_accepted', handleCallAccepted);
    SocketService.on('call_rejected', handleCallRejected);
    SocketService.on('call_ended', handleCallEnded);
    SocketService.on('call_cancelled', handleCallCancelled);
    SocketService.on('call_initiated', handleCallInitiated);
    SocketService.on('call_ringing_offline', handleCallRingingOffline);
    SocketService.on('call_timeout', handleCallTimeout);
    SocketService.on('webrtc_offer', handleSocketOffer);
    SocketService.on('webrtc_answer', handleSocketAnswer);
    SocketService.on('ice_candidate', handleSocketIceCandidate);
  };

  const cleanupSocketListeners = () => {
    SocketService.off('call_accepted', handleCallAccepted);
    SocketService.off('call_rejected', handleCallRejected);
    SocketService.off('call_ended', handleCallEnded);
    SocketService.off('call_cancelled', handleCallCancelled);
    SocketService.off('call_initiated', handleCallInitiated);
    SocketService.off('call_ringing_offline', handleCallRingingOffline);
    SocketService.off('call_timeout', handleCallTimeout);
    SocketService.off('webrtc_offer', handleSocketOffer);
    SocketService.off('webrtc_answer', handleSocketAnswer);
    SocketService.off('ice_candidate', handleSocketIceCandidate);
  };

  // ============================================
  // Socket handlers
  // ============================================

  const handleCallInitiated = (data) => {
    if (data.to === peer) {
      callIdRef.current = data.callId;
    }
  };

  const handleCallRingingOffline = (data) => {
    if (data.to === peer || data.callId) {
      callIdRef.current = data.callId;
    }
  };

  const handleCallAccepted = async () => {
    if (!isMountedRef.current) return;
    if (offerSentRef.current) return;
    offerSentRef.current = true;

    callStateRef.current = 'connecting';
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }

    // Give receiver time to prepare PeerConnection
    await new Promise(r => setTimeout(r, 800));
    if (!isMountedRef.current) return;

    sendToWebView({type: 'createOffer'});
  };

  const handleCallTimeout = () => {
    if (!isMountedRef.current) return;
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    Alert.alert('Нет ответа', 'Собеседник не отвечает', [
      {text: 'OK', onPress: () => { cleanup(); navigation.goBack(); }},
    ]);
  };

  const handleCallRejected = () => {
    if (!isMountedRef.current) return;
    Alert.alert('Звонок отклонён', 'Собеседник отклонил звонок', [
      {text: 'OK', onPress: () => { cleanup(); navigation.goBack(); }},
    ]);
  };

  const handleCallEnded = () => {
    if (!isMountedRef.current) return;
    cleanup();
    navigation.goBack();
  };

  const handleCallCancelled = () => {
    if (!isMountedRef.current) return;
    cleanup();
    navigation.goBack();
  };

  // Socket → WebView: incoming offer from peer
  const handleSocketOffer = (data) => {
    if (data.from !== peer) return;
    if (!isMountedRef.current) return;
    sendToWebView({type: 'handleOffer', offer: data.offer});
  };

  // Socket → WebView: incoming answer from peer
  const handleSocketAnswer = (data) => {
    if (data.from !== peer) return;
    if (!isMountedRef.current) return;
    sendToWebView({type: 'handleAnswer', answer: data.answer});
  };

  // Socket → WebView: incoming ICE candidate from peer
  const handleSocketIceCandidate = (data) => {
    if (data.from !== peer) return;
    sendToWebView({type: 'addIceCandidate', candidate: data.candidate});
  };

  // ============================================
  // WebView → RN message handling
  // ============================================

  const handleWebViewMessage = (event) => {
    if (!event.nativeEvent.data) return;
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      switch (msg.type) {
        case 'ready':
          webViewReady.current = true;
          flushPendingMessages();
          // Fetch ICE config then initialize WebView
          initializeWebView();
          break;

        case 'mediaReady':
          // Media acquired, if receiver with offer — process it
          if (!isCaller && offer) {
            setTimeout(() => {
              sendToWebView({type: 'handleOffer', offer});
            }, 300);
          }
          break;

        case 'offer':
          // WebView created offer → send to peer via Socket
          SocketService.sendWebRTCOffer(peer, msg.offer);
          break;

        case 'answer':
          // WebView created answer → send to peer via Socket
          SocketService.sendWebRTCAnswer(peer, msg.answer);
          answerSentRef.current = true;
          break;

        case 'iceCandidate':
          // WebView generated ICE candidate → send to peer via Socket
          SocketService.sendIceCandidate(peer, msg.candidate);
          break;

        case 'connected':
          if (callStateRef.current !== 'connected') {
            callStateRef.current = 'connected';
            if (callTimeoutRef.current) {
              clearTimeout(callTimeoutRef.current);
              callTimeoutRef.current = null;
            }
            startCallTimer();
          }
          break;

        case 'connectionFailed':
          if (!isCleanedUpRef.current) {
            Alert.alert('Соединение потеряно', 'Связь с собеседником прервана', [
              {text: 'OK', onPress: handleEndCall},
            ]);
          }
          break;

        case 'disconnected':
          // ICE disconnected — might recover automatically
          break;

        case 'endCall':
          handleEndCall();
          break;

        case 'error':
          console.warn('[CallScreen.windows] WebView error:', msg.message);
          break;
      }
    } catch (e) {
      // ignore parse errors
    }
  };

  // ============================================
  // Initialize WebView with ICE config
  // ============================================

  const initializeWebView = async () => {
    let iceConfig = null;
    try {
      const resp = await fetch(`${SERVER_URL}/webrtc-config`, {
        method: 'GET',
        headers: {Accept: 'application/json'},
      });
      if (resp.ok) {
        iceConfig = await resp.json();
      }
    } catch (e) {
      // Use defaults in WebView
    }
    sendToWebView({type: 'init', config: iceConfig || {}});
  };

  // ============================================
  // Call timer & lifecycle
  // ============================================

  const startCallTimer = () => {
    if (callTimerRef.current) return;
    let sec = 0;
    callTimerRef.current = setInterval(() => {
      sec++;
      setCallDuration(sec);
      sendToWebView({type: 'updateDuration', seconds: sec});
    }, 1000);
  };

  const handleEndCall = () => {
    if (isCleanedUpRef.current) return;
    NotificationService.cancelAllNotifications();
    if (isCaller && callStateRef.current === 'calling') {
      SocketService.cancelCall(peer, callIdRef.current);
    } else {
      SocketService.endCall(peer, callIdRef.current);
    }
    cleanup();
    navigation.goBack();
  };

  const cleanup = () => {
    if (isCleanedUpRef.current) return;
    isCleanedUpRef.current = true;
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    sendToWebView({type: 'cleanup'});
    cleanupSocketListeners();
  };

  // ============================================
  // Render
  // ============================================

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <WebView
        ref={webViewRef}
        source={{html: getCallHTML(peer, isVideo, isCaller)}}
        onMessage={handleWebViewMessage}
        style={styles.webview}
        javaScriptEnabled={true}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        originWhitelist={['*']}
        allowFileAccess={true}
        mediaCapturePermissionGrantType="grant"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  webview: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
});
