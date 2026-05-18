/* =============================================================
   BuyForMe — call-webrtc.js
   WebRTC voice/video — remote audio playback + Uber-style controls
   ============================================================= */

import { getConvId } from "./chat-local.js";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
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
  }

  async start() {
    this._buildOverlay();

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: this.isVideo ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } : false,
      });
    } catch {
      alert(`${this.isVideo ? "Camera/" : ""}Microphone access denied.`);
      this.end();
      return;
    }

    this._attachLocalPreview();

    if (!this.channelReady) await this._connectSignaling();
    this._createPeer();

    if (this.isCaller) {
      this.pc.onicecandidate = e => {
        if (e.candidate) this._sendSignal({ type: "ice", candidate: e.candidate.toJSON() });
      };
      await new Promise(r => setTimeout(r, 1200));
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this._sendSignal({ type: "offer", sdp: offer });
      this._startRingingTimeout();
    } else {
      this.pc.onicecandidate = e => {
        if (e.candidate) this._sendSignal({ type: "ice", candidate: e.candidate.toJSON() });
      };
      await this._drainQueue();
    }

    await this._unlockAudioPlayback();
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
    } catch {
      // Autoplay blocked until user taps — show tap hint
      const hint = document.getElementById("bfmTapToHear");
      if (hint) hint.style.display = "block";
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
    }

    this._setStatus("Connected — you can talk now");
  }

  _setStatus(text) {
    const s = document.getElementById("bfmCallStatus");
    if (s) s.textContent = text;
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
      if (st === "connected") this._setStatus("Connected — you can talk now");
      else if (st === "failed" || st === "disconnected") {
        this._setStatus("Connection lost — try ending and calling again");
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const st = this.pc?.iceConnectionState;
      if (st === "failed") this._setStatus("Network issue — try again on Wi‑Fi");
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
    if (this.channelReady) return;
    try {
      await this._connectSignaling();
    } catch (e) {
      console.warn("Call signaling pre-connect:", e.message);
    }
  }

  async _handleSignal(payload) {
    if (!this.pc || this.ended) return;

    if (payload.type === "offer" && !this.isCaller) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      await this._flushIceQueue();
      const answer = await this.pc.createAnswer();
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
        this._setStatus("Still ringing… ask them to tap Accept");
      }
    }, 25000);
  }

  async rejectRemote() {
    await this._sendSignal({ type: "reject" });
  }

  toggleMic() {
    this.micEnabled = !this.micEnabled;
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = this.micEnabled; });
    const btn = document.getElementById("bfmMuteBtn");
    if (btn) {
      btn.textContent = this.micEnabled ? "🎤 Mute" : "🔇 Unmute";
      btn.style.background = this.micEnabled ? "rgba(255,255,255,0.15)" : "#e74c3c";
    }
  }

  _buildOverlay() {
    document.getElementById("bfmCallOverlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "bfmCallOverlay";
    overlay.innerHTML = `
      <div style="position:fixed;inset:0;background:#0f1c18;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:20px">
        <p style="color:#fff;font-family:'Sora',sans-serif;font-size:1.05rem;margin:0">
          ${this.isVideo ? "📹 Video" : "📞 Voice"} call — ${this.partnerName}
        </p>
        ${this.isVideo ? `
        <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;align-items:center">
          <div style="text-align:center">
            <p style="color:#888;font-size:0.7rem;margin:0 0 4px">You</p>
            <video id="bfmLocalVideo" autoplay muted playsinline style="width:min(140px,38vw);border-radius:12px;background:#222;transform:scaleX(-1)"></video>
          </div>
          <div style="text-align:center">
            <p style="color:#888;font-size:0.7rem;margin:0 0 4px">${this.partnerName}</p>
            <video id="bfmRemoteVideo" autoplay playsinline style="width:min(220px,55vw);border-radius:12px;background:#222"></video>
          </div>
        </div>` : `
        <div style="width:96px;height:96px;border-radius:50%;background:#1a9e6e;display:flex;align-items:center;justify-content:center;font-size:2.2rem;color:#fff;font-family:'Sora',sans-serif;font-weight:700">
          ${(this.partnerName || "?")[0].toUpperCase()}
        </div>`}
        <p style="color:#9ab;font-size:0.88rem;margin:0" id="bfmCallStatus">${this.isCaller ? "Calling…" : "Connecting…"}</p>
        <p id="bfmTapToHear" style="display:none;color:#f1c40f;font-size:0.82rem;margin:0;cursor:pointer;text-decoration:underline">
          Tap here if you can't hear them
        </p>
        <audio id="bfmRemoteAudio" autoplay playsinline style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"></audio>
        <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:8px">
          <button type="button" id="bfmMuteBtn" style="padding:10px 18px;background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.25);border-radius:24px;font-size:0.85rem;cursor:pointer">🎤 Mute</button>
          <button type="button" id="bfmEndCallBtn" style="padding:10px 24px;background:#e74c3c;color:#fff;border:none;border-radius:24px;font-size:0.9rem;cursor:pointer;font-weight:600">End call</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    this.overlay = overlay;

    document.getElementById("bfmEndCallBtn")?.addEventListener("click", () => this.end());
    document.getElementById("bfmMuteBtn")?.addEventListener("click", () => this.toggleMic());
    document.getElementById("bfmTapToHear")?.addEventListener("click", () => this._unlockAudioPlayback());
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this._ringTimer);

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
    this.overlay = null;
  }
}

let incomingPrep = null;

export async function prepareIncomingCallSignaling(supabase, myUserId, partnerUserId, callType) {
  incomingPrep?.end();
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
  incomingPrep?.end();
  incomingPrep = null;
}

export async function rejectIncomingCall() {
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
