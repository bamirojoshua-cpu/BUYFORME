/* =============================================================
   BuyForMe — call-webrtc.js
   WebRTC voice/video — WhatsApp-style call UI
   ============================================================= */

import { getConvId } from "./chat-local.js";
import {
  playCallConnectedSound,
  stopOutgoingRingback,
  stopIncomingCallRing,
  stopAllCallSounds,
  playCallEndedSound,
} from "./app-sounds.js";
import { getCallInitials, escapeCallHtml } from "./call-ui.js";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
};

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export function getCallChannelName(uidA, uidB, callType) {
  return `call_${getConvId(uidA, uidB)}_${callType}`;
}

export class WebRTCCall {
  constructor({ supabase, myUserId, partnerUserId, partnerName, callType, isCaller }) {
    this.supabase = supabase;
    this.myUserId = String(myUserId);
    this.partnerUserId = String(partnerUserId);
    this.partnerName = partnerName || "User";
    this.callType = callType;
    this.isCaller = isCaller;
    this.isVideo = callType === "video";

    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.channel = null;
    this.channelReady = false;
    this.signalQueue = [];
    this.iceQueue = [];
    this.overlay = null;
    this.ended = false;
    this.micEnabled = true;
    this.cameraEnabled = true;
    this.speakerOn = true;
    this._facingMode = "user";
    this._videoDeviceIds = [];
    this._videoDeviceIndex = 0;
    this._offerSent = false;
    this._connectedSoundPlayed = false;
    this._callStartTime = null;
    this._timerInterval = null;
    this._offerReadyTimeout = null;
  }

  _offerOptions() {
    return {
      offerToReceiveAudio: true,
      offerToReceiveVideo: this.isVideo,
    };
  }

  async start() {
    this._buildOverlay();

    if (!this.channelReady) {
      try {
        await this._connectSignaling();
      } catch (e) {
        alert(e.message || "Could not connect call signaling.");
        this.end(false);
        return;
      }
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: this.isVideo ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } : false,
      });
    } catch {
      alert(`${this.isVideo ? "Camera/" : ""}Microphone access denied.`);
      this.end(false);
      return;
    }

    if (this.isVideo) await this._cacheVideoDevices();

    this._attachLocalPreview();
    this._createPeer();

    this.pc.onicecandidate = e => {
      if (e.candidate) this._sendSignal({ type: "ice", candidate: e.candidate.toJSON() });
    };

    if (this.isCaller) {
      this._offerSent = false;
      this._offerReadyTimeout = setTimeout(() => this._sendOfferIfCaller(), 500);
    } else {
      await this._drainQueue();
    }

    await this._unlockAudioPlayback();
  }

  async _sendOfferIfCaller() {
    if (!this.isCaller || this._offerSent || !this.pc || this.ended) return;
    this._offerSent = true;
    clearTimeout(this._offerReadyTimeout);
    this._offerReadyTimeout = null;

    try {
      const offer = await this.pc.createOffer(this._offerOptions());
      await this.pc.setLocalDescription(offer);
      await this._sendSignal({ type: "offer", sdp: offer });
      this._startRingingTimeout();
    } catch (e) {
      console.error("createOffer:", e);
      this._setStatus("Could not start call");
    }
  }

  async _cacheVideoDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this._videoDeviceIds = devices
        .filter(d => d.kind === "videoinput" && d.deviceId)
        .map(d => d.deviceId);
      const currentId = this.localStream?.getVideoTracks?.()[0]?.getSettings?.()?.deviceId;
      if (currentId) {
        const idx = this._videoDeviceIds.indexOf(currentId);
        if (idx >= 0) this._videoDeviceIndex = idx;
      }
    } catch {
      this._videoDeviceIds = [];
    }
  }

  _attachLocalPreview() {
    const localVid = document.getElementById("bfmLocalVideo");
    if (localVid && this.isVideo) {
      localVid.srcObject = this.localStream;
      localVid.muted = true;
      localVid.play().catch(() => {});
    }
  }

  async _unlockAudioPlayback() {
    const audio = document.getElementById("bfmRemoteAudio");
    if (!audio) return;
    audio.volume = 1;
    audio.muted = false;
    try {
      await audio.play();
      const hint = document.getElementById("bfmTapToHear");
      if (hint) hint.style.display = "none";
    } catch {
      const hint = document.getElementById("bfmTapToHear");
      if (hint) hint.style.display = "inline-block";
    }
  }

  _attachRemoteStream(stream) {
    if (!stream) return;
    this.remoteStream = stream;

    const audio = document.getElementById("bfmRemoteAudio");
    if (audio) {
      audio.srcObject = stream;
      audio.volume = 1;
      audio.muted = false;
      audio.play().catch(() => {
        const hint = document.getElementById("bfmTapToHear");
        if (hint) hint.style.display = "block";
      });
    }

    const video = document.getElementById("bfmRemoteVideo");
    if (video && this.isVideo) {
      video.srcObject = stream;
      video.volume = 1;
      video.muted = false;
      video.playsInline = true;
      video.play().catch(() => {});
      if (stream.getVideoTracks().length) this._hideRemotePlaceholder();
    }

    this._setStatus("connected");
    this._onCallConnected();
  }

  _onCallConnected() {
    if (this._connectedSoundPlayed) return;
    const linked =
      this.pc?.connectionState === "connected" ||
      this.pc?.iceConnectionState === "connected" ||
      (this.remoteStream?.getTracks?.().length ?? 0) > 0;
    if (!linked) return;
    this._connectedSoundPlayed = true;
    stopIncomingCallRing();
    stopOutgoingRingback();
    playCallConnectedSound();
    this._startCallTimer();
  }

  _startCallTimer() {
    if (this._callStartTime) return;
    this._callStartTime = Date.now();
    clearInterval(this._timerInterval);
    const tick = () => {
      if (!this._callStartTime) return;
      const sec = Math.floor((Date.now() - this._callStartTime) / 1000);
      const m = Math.floor(sec / 60);
      const s = String(sec % 60).padStart(2, "0");
      this._setStatus(`${m}:${s}`);
    };
    tick();
    this._timerInterval = setInterval(tick, 1000);
  }

  _setStatus(text) {
    const el = document.getElementById("bfmCallStatus");
    if (!el) return;
    if (text === "connected") {
      if (this._callStartTime) return;
      el.textContent = "Connected";
      return;
    }
    const labels = {
      calling: "Calling…",
      ringing: "Ringing…",
      connecting: "Connecting…",
    };
    el.textContent = labels[text] || text;
  }

  _createPeer() {
    this.pc = new RTCPeerConnection(ICE_SERVERS);

    const tracks = this.localStream.getTracks();
    tracks.forEach(track => this.pc.addTrack(track, this.localStream));

    if (!tracks.some(t => t.kind === "audio")) {
      this.pc.addTransceiver("audio", { direction: "sendrecv" });
    }
    if (this.isVideo && !tracks.some(t => t.kind === "video")) {
      this.pc.addTransceiver("video", { direction: "sendrecv" });
    }

    this.remoteStream = new MediaStream();

    this.pc.ontrack = e => {
      const track = e.track;
      if (!track) return;

      if (!this.remoteStream.getTracks().some(t => t.id === track.id)) {
        this.remoteStream.addTrack(track);
      }

      this._attachRemoteStream(this.remoteStream);

      track.onunmute = () => this._attachRemoteStream(this.remoteStream);
    };

    this.pc.onconnectionstatechange = () => {
      const st = this.pc?.connectionState;
      if (st === "connected") {
        this._setStatus("connected");
        this._onCallConnected();
      } else if (st === "failed" || st === "disconnected") {
        clearInterval(this._timerInterval);
        this._setStatus("Connection lost");
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const st = this.pc?.iceConnectionState;
      if (st === "failed") this._setStatus("Poor connection");
    };
  }

  async _connectSignaling() {
    const name = getCallChannelName(this.myUserId, this.partnerUserId, this.callType);
    if (this.channel) this.supabase.removeChannel(this.channel);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Call signaling timed out")), 12000);

      this.channel = this.supabase
        .channel(name, { config: { broadcast: { self: false } } })
        .on("broadcast", { event: "signal" }, ({ payload }) => {
          if (!payload || String(payload.from) === this.myUserId) return;
          if (this.pc) this._handleSignal(payload).catch(console.error);
          else this.signalQueue.push(payload);
        })
        .subscribe(status => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timeout);
            this.channelReady = true;
            resolve();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(timeout);
            reject(new Error("Could not connect call signaling."));
          }
        });
    });
  }

  async prepareIncoming() {
    if (!this.channelReady) {
      try {
        await this._connectSignaling();
      } catch (e) {
        console.warn("Call signaling pre-connect:", e.message);
        return;
      }
    }
    try {
      await this._sendSignal({ type: "ready" });
    } catch {
      /* callee will still connect when user accepts */
    }
  }

  async _handleSignal(payload) {
    if (!this.pc || this.ended) return;

    if (payload.type === "ready" && this.isCaller) {
      await this._sendOfferIfCaller();
    } else if (payload.type === "offer" && !this.isCaller) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      await this._flushIceQueue();
      const answer = await this.pc.createAnswer(this._offerOptions());
      await this.pc.setLocalDescription(answer);
      await this._sendSignal({ type: "answer", sdp: answer });
    } else if (payload.type === "answer" && this.isCaller) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      await this._flushIceQueue();
      clearTimeout(this._ringTimer);
      await this._unlockAudioPlayback();
    } else if (payload.type === "ice" && payload.candidate) {
      const candidate = new RTCIceCandidate(payload.candidate);
      if (this.pc.remoteDescription) {
        try { await this.pc.addIceCandidate(candidate); } catch {}
      } else {
        this.iceQueue.push(candidate);
      }
    } else if (payload.type === "reject") {
      alert(`${this.partnerName} declined the call.`);
      this.end();
    }
  }

  async _drainQueue() {
    const q = [...this.signalQueue];
    this.signalQueue = [];
    for (const p of q) await this._handleSignal(p);
  }

  async _flushIceQueue() {
    while (this.iceQueue.length && this.pc) {
      const c = this.iceQueue.shift();
      try { await this.pc.addIceCandidate(c); } catch {}
    }
  }

  async _sendSignal(payload) {
    if (!this.channel || !this.channelReady) return;
    await this.channel.send({
      type: "broadcast",
      event: "signal",
      payload: { ...payload, from: this.myUserId },
    });
  }

  _startRingingTimeout() {
    clearTimeout(this._ringTimer);
    this._ringTimer = setTimeout(() => {
      if (this.ended || !this.isCaller) return;
      if (this.pc && !this.pc.currentRemoteDescription) {
        this._setStatus("ringing");
      }
    }, 25000);
  }

  async rejectRemote() {
    await this._sendSignal({ type: "reject" });
  }

  _updateCtrlBtn(id, active, offClass = "bfm-call-ctrl-btn--off") {
    document.getElementById(id)?.classList.toggle(offClass, !active);
  }

  toggleMic() {
    this.micEnabled = !this.micEnabled;
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = this.micEnabled; });
    const btn = document.getElementById("bfmMuteBtn");
    if (btn) {
      btn.classList.toggle("bfm-call-ctrl-btn--off", !this.micEnabled);
      btn.innerHTML = this.micEnabled
        ? '<i class="fa-solid fa-microphone"></i>'
        : '<i class="fa-solid fa-microphone-slash"></i>';
    }
  }

  toggleCamera() {
    if (!this.isVideo) return;
    this.cameraEnabled = !this.cameraEnabled;
    this.localStream?.getVideoTracks().forEach(t => { t.enabled = this.cameraEnabled; });
    this._updateCtrlBtn("bfmCamBtn", this.cameraEnabled);
    const btn = document.getElementById("bfmCamBtn");
    if (btn) {
      btn.innerHTML = this.cameraEnabled
        ? '<i class="fa-solid fa-video"></i>'
        : '<i class="fa-solid fa-video-slash"></i>';
    }
    const pip = document.getElementById("bfmLocalVideo");
    if (pip) pip.style.opacity = this.cameraEnabled ? "1" : "0.35";
  }

  async _applyVideoTrack(newTrack) {
    if (!newTrack || !this.localStream) return false;
    const oldTrack = this.localStream.getVideoTracks()[0];
    if (oldTrack?.id === newTrack.id) return true;

    const sender = this.pc?.getSenders?.().find(s => s.track?.kind === "video");
    if (sender) {
      await sender.replaceTrack(newTrack);
    } else if (this.pc) {
      this.pc.addTrack(newTrack, this.localStream);
    }

    if (oldTrack) {
      this.localStream.removeTrack(oldTrack);
      oldTrack.stop();
    }
    if (!this.localStream.getVideoTracks().includes(newTrack)) {
      this.localStream.addTrack(newTrack);
    }

    const localVid = document.getElementById("bfmLocalVideo");
    if (localVid) {
      localVid.srcObject = this.localStream;
      await localVid.play().catch(() => {});
    }
    return true;
  }

  async _getFlippedVideoStream() {
    if (this._videoDeviceIds.length >= 2) {
      this._videoDeviceIndex = (this._videoDeviceIndex + 1) % this._videoDeviceIds.length;
      const deviceId = this._videoDeviceIds[this._videoDeviceIndex];
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch {
        /* try ideal deviceId without exact */
        try {
          return await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { deviceId, width: { ideal: 640 }, height: { ideal: 480 } },
          });
        } catch {
          /* fall through to facingMode */
        }
      }
    }

    this._facingMode = this._facingMode === "user" ? "environment" : "user";
    const modes = [
      { facingMode: { exact: this._facingMode } },
      { facingMode: this._facingMode },
    ];
    for (const video of modes) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { ...video, width: { ideal: 640 }, height: { ideal: 480 } },
        });
      } catch {
        /* next */
      }
    }
    return null;
  }

  async flipCamera() {
    if (!this.isVideo || !this.localStream) return;

    const oldTrack = this.localStream.getVideoTracks()[0];
    try {
      const newStream = await this._getFlippedVideoStream();
      const newTrack = newStream?.getVideoTracks?.()[0];
      if (!newTrack) throw new Error("No camera track");

      const ok = await this._applyVideoTrack(newTrack);
      if (ok) {
        newStream.getTracks().forEach(t => {
          if (t !== newTrack) t.stop();
        });
        return;
      }
    } catch (e) {
      console.warn("flipCamera:", e);
    }

    if (oldTrack) {
      this.localStream.addTrack(oldTrack);
    }
  }

  async toggleSpeaker() {
    this.speakerOn = !this.speakerOn;
    const audio = document.getElementById("bfmRemoteAudio");
    if (audio) audio.volume = this.speakerOn ? 1 : 0.35;
    this._updateCtrlBtn("bfmSpeakerBtn", this.speakerOn, "bfm-call-ctrl-btn--active");
  }

  _isMobileCallUi() {
    return typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
  }

  _controlsHtml(isVideo) {
    if (this._isMobileCallUi()) {
      return isVideo ? this._controlsHtmlMobileVideo() : this._controlsHtmlMobileVoice();
    }
    return this._controlsHtmlDesktop(isVideo);
  }

  _controlsHtmlDesktop(isVideo) {
    const videoCtrls = isVideo ? `
      <div class="bfm-call-ctrl">
        <button type="button" class="bfm-call-ctrl-btn" id="bfmFlipBtn" aria-label="Flip camera"><i class="fa-solid fa-rotate"></i></button>
        <span class="bfm-call-ctrl-label">Flip</span>
      </div>
      <div class="bfm-call-ctrl">
        <button type="button" class="bfm-call-ctrl-btn" id="bfmCamBtn" aria-label="Toggle camera"><i class="fa-solid fa-video"></i></button>
        <span class="bfm-call-ctrl-label">Video</span>
      </div>` : "";

    return `
      <footer class="bfm-call-controls">
        <div class="bfm-call-controls-row">
          <div class="bfm-call-ctrl">
            <button type="button" class="bfm-call-ctrl-btn bfm-call-ctrl-btn--active" id="bfmSpeakerBtn" aria-label="Speaker"><i class="fa-solid fa-volume-high"></i></button>
            <span class="bfm-call-ctrl-label">Speaker</span>
          </div>
          <div class="bfm-call-ctrl">
            <button type="button" class="bfm-call-ctrl-btn" id="bfmMuteBtn" aria-label="Mute"><i class="fa-solid fa-microphone"></i></button>
            <span class="bfm-call-ctrl-label">Mute</span>
          </div>
          <div class="bfm-call-ctrl">
            <button type="button" class="bfm-call-ctrl-btn bfm-call-ctrl-btn--end" id="bfmEndCallBtn" aria-label="End call"><i class="fa-solid fa-phone-slash"></i></button>
            <span class="bfm-call-ctrl-label">End</span>
          </div>
          ${videoCtrls}
        </div>
      </footer>`;
  }

  _controlsHtmlMobileVoice() {
    return `
      <footer class="bfm-call-controls bfm-call-controls--mobile">
        <div class="bfm-call-controls-row bfm-call-controls-row--wa-voice">
          <button type="button" class="bfm-call-ctrl-btn bfm-call-ctrl-btn--active" id="bfmSpeakerBtn" aria-label="Speaker"><i class="fa-solid fa-volume-high"></i></button>
          <button type="button" class="bfm-call-ctrl-btn bfm-call-ctrl-btn--end" id="bfmEndCallBtn" aria-label="End call"><i class="fa-solid fa-phone-slash"></i></button>
          <button type="button" class="bfm-call-ctrl-btn" id="bfmMuteBtn" aria-label="Mute"><i class="fa-solid fa-microphone"></i></button>
        </div>
      </footer>`;
  }

  _controlsHtmlMobileVideo() {
    return `
      <footer class="bfm-call-controls bfm-call-controls--mobile">
        <div class="bfm-call-controls-row bfm-call-controls-row--wa-video">
          <button type="button" class="bfm-call-ctrl-btn" id="bfmFlipBtn" aria-label="Flip camera"><i class="fa-solid fa-rotate"></i></button>
          <button type="button" class="bfm-call-ctrl-btn" id="bfmCamBtn" aria-label="Toggle camera"><i class="fa-solid fa-video"></i></button>
          <button type="button" class="bfm-call-ctrl-btn bfm-call-ctrl-btn--end" id="bfmEndCallBtn" aria-label="End call"><i class="fa-solid fa-phone-slash"></i></button>
          <button type="button" class="bfm-call-ctrl-btn" id="bfmMuteBtn" aria-label="Mute"><i class="fa-solid fa-microphone"></i></button>
          <button type="button" class="bfm-call-ctrl-btn bfm-call-ctrl-btn--active" id="bfmSpeakerBtn" aria-label="Speaker"><i class="fa-solid fa-volume-high"></i></button>
        </div>
      </footer>`;
  }

  _hideRemotePlaceholder() {
    document.getElementById("bfmRemotePlaceholder")?.style.setProperty("display", "none");
  }

  _buildOverlay() {
    document.getElementById("bfmCallOverlay")?.remove();
    const initials = getCallInitials(this.partnerName);
    const safeName = escapeCallHtml(this.partnerName);
    const statusText = this.isCaller ? "Calling…" : "Connecting…";

    const overlay = document.createElement("div");
    overlay.id = "bfmCallOverlay";
    const mobileUi = this._isMobileCallUi();
    overlay.className = `bfm-call-screen${this.isVideo ? " bfm-call-screen--video" : ""}${mobileUi ? " bfm-call-screen--mobile" : ""}`;
    document.body.classList.add("bfm-call-active");

    if (this.isVideo) {
      overlay.innerHTML = `
        <div class="bfm-call-remote-wrap" id="bfmRemoteWrap">
          <video id="bfmRemoteVideo" autoplay playsinline></video>
          <div class="bfm-call-remote-placeholder" id="bfmRemotePlaceholder">
            <div class="bfm-call-avatar">${initials}</div>
          </div>
        </div>
        <div class="bfm-call-pip">
          <video id="bfmLocalVideo" autoplay muted playsinline></video>
        </div>
        <header class="bfm-call-top">
          <h1 class="bfm-call-top-name">${safeName}</h1>
          <p class="bfm-call-top-status" id="bfmCallStatus">${statusText}</p>
        </header>
        <audio id="bfmRemoteAudio" class="bfm-call-hidden-audio" autoplay playsinline></audio>
        <button type="button" class="bfm-call-tap-hint" id="bfmTapToHear">Tap to hear audio</button>
        ${this._controlsHtml(true)}`;
    } else {
      overlay.innerHTML = `
        <div class="bfm-call-voice-body">
          <div class="bfm-call-avatar">${initials}</div>
          <h1 class="bfm-call-voice-name">${safeName}</h1>
          <p class="bfm-call-voice-status" id="bfmCallStatus">${statusText}</p>
          <button type="button" class="bfm-call-tap-hint" id="bfmTapToHear">Tap to hear audio</button>
        </div>
        <audio id="bfmRemoteAudio" class="bfm-call-hidden-audio" autoplay playsinline></audio>
        ${this._controlsHtml(false)}`;
    }

    document.body.appendChild(overlay);
    this.overlay = overlay;

    document.getElementById("bfmEndCallBtn")?.addEventListener("click", () => this.end());
    document.getElementById("bfmMuteBtn")?.addEventListener("click", () => this.toggleMic());
    document.getElementById("bfmSpeakerBtn")?.addEventListener("click", () => this.toggleSpeaker());
    document.getElementById("bfmCamBtn")?.addEventListener("click", () => this.toggleCamera());
    document.getElementById("bfmFlipBtn")?.addEventListener("click", () => this.flipCamera());
    document.getElementById("bfmTapToHear")?.addEventListener("click", () => this._unlockAudioPlayback());
  }

  end(playEndTone = true) {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this._ringTimer);
    clearTimeout(this._offerReadyTimeout);
    clearInterval(this._timerInterval);
    this._timerInterval = null;
    this._callStartTime = null;
    stopAllCallSounds();

    this.remoteStream?.getTracks().forEach(t => t.stop());
    this.remoteStream = null;

    this.pc?.close();
    this.pc = null;
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;

    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.channelReady = false;
    this.signalQueue = [];
    this.iceQueue = [];

    document.getElementById("bfmCallOverlay")?.remove();
    document.body.classList.remove("bfm-call-active");
    this.overlay = null;
    if (playEndTone) playCallEndedSound();
  }
}

let incomingPrep = null;

export async function prepareIncomingCallSignaling(supabase, myUserId, partnerUserId, callType) {
  incomingPrep?.end(false);
  incomingPrep = new WebRTCCall({
    supabase,
    myUserId,
    partnerUserId,
    callType,
    isCaller: false,
  });
  await incomingPrep.prepareIncoming();
  return incomingPrep;
}

export function clearIncomingCallPrep() {
  incomingPrep?.end(false);
  incomingPrep = null;
}

export async function rejectIncomingCall() {
  stopAllCallSounds();
  if (incomingPrep) {
    try { await incomingPrep.rejectRemote(); } catch {}
    incomingPrep.end();
    incomingPrep = null;
  }
}

export async function startOutgoingCall(opts) {
  clearIncomingCallPrep();
  const call = new WebRTCCall({ ...opts, isCaller: true });
  await call.start();
  return call;
}

export async function acceptIncomingCall(opts) {
  const call = incomingPrep && String(incomingPrep.partnerUserId) === String(opts.partnerUserId)
    ? incomingPrep
    : new WebRTCCall({ ...opts, isCaller: false });

  call.partnerName = opts.partnerName || call.partnerName;
  call.isCaller = false;
  if (!call.channelReady) await call.prepareIncoming();
  await call.start();
  incomingPrep = null;
  return call;
}
