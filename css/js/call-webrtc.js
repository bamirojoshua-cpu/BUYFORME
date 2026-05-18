/* =============================================================
   BuyForMe — call-webrtc.js
   Shared WebRTC voice/video signaling over Supabase broadcast
   ============================================================= */

import { getConvId } from "./chat-local.js";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
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
    this.channel = null;
    this.channelReady = false;
    this.signalQueue = [];
    this.iceQueue = [];
    this.overlay = null;
    this.ended = false;
  }

  async start() {
    this._buildOverlay();
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(
        this.isVideo ? { video: true, audio: true } : { audio: true }
      );
      if (this.isVideo) {
        const localVid = document.getElementById("bfmLocalVideo");
        if (localVid) localVid.srcObject = this.localStream;
      }
    } catch {
      alert(`${this.isVideo ? "Camera/" : ""}Microphone access denied.`);
      this.end();
      return;
    }

    if (!this.channelReady) await this._connectSignaling();
    this._createPeer();

    if (this.isCaller) {
      await this._waitChannelReady();
      this.pc.onicecandidate = e => {
        if (e.candidate) this._sendSignal({ type: "ice", candidate: e.candidate.toJSON() });
      };
      // Let callee receive invite and join signaling channel
      await new Promise(r => setTimeout(r, 1500));
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

  _createPeer() {
    this.pc = new RTCPeerConnection(ICE_SERVERS);
    this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));

    this.pc.ontrack = e => {
      if (this.isVideo) {
        const v = document.getElementById("bfmRemoteVideo");
        if (v) v.srcObject = e.streams[0];
      } else {
        const a = document.getElementById("bfmRemoteAudio");
        if (a) a.srcObject = e.streams[0];
        const s = document.getElementById("bfmCallStatus");
        if (s) s.textContent = "Connected";
      }
    };
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
      const status = document.getElementById("bfmCallStatus");
      if (status) status.textContent = "Connected";
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
    if (!this.channel || !this.channelReady) {
      console.warn("Call signal skipped — channel not ready", payload?.type);
      return;
    }
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
      const status = document.getElementById("bfmCallStatus");
      if (status && this.pc && !this.pc.currentRemoteDescription) {
        status.textContent = "No answer — ask them to open chat and accept the call";
      }
    }, 25000);
  }

  async rejectRemote() {
    await this._sendSignal({ type: "reject" });
  }

  _buildOverlay() {
    document.getElementById("bfmCallOverlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "bfmCallOverlay";
    overlay.innerHTML = `
      <div style="position:fixed;inset:0;background:#111;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px">
        <p style="color:#fff;font-family:'Sora',sans-serif;font-size:1.1rem">${this.isVideo ? "📹" : "📞"} ${this.isVideo ? "Video" : "Voice"} Call — ${this.partnerName}</p>
        ${this.isVideo ? `
        <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center">
          <video id="bfmLocalVideo" autoplay muted playsinline style="width:min(200px,42vw);border-radius:12px;background:#222"></video>
          <video id="bfmRemoteVideo" autoplay playsinline style="width:min(320px,55vw);border-radius:12px;background:#222"></video>
        </div>` : `
        <div style="width:100px;height:100px;border-radius:50%;background:#1a9e6e;display:flex;align-items:center;justify-content:center;font-size:2.5rem;color:#fff;font-family:'Sora',sans-serif;font-weight:700">
          ${(this.partnerName || "?")[0].toUpperCase()}
        </div>
        <p style="color:#aaa;font-size:0.9rem" id="bfmCallStatus">${this.isCaller ? "Calling…" : "Connecting…"}</p>
        <audio id="bfmRemoteAudio" autoplay playsinline></audio>`}
        <button type="button" id="bfmEndCallBtn" style="padding:12px 32px;background:#e74c3c;color:#fff;border:none;border-radius:24px;font-size:0.95rem;cursor:pointer;margin-top:8px">
          ${this.isVideo ? "End Call" : "🔴 End Call"}
        </button>
      </div>`;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    document.getElementById("bfmEndCallBtn")?.addEventListener("click", () => this.end());
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this._ringTimer);
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

  async _waitChannelReady() {
    if (this.channelReady) return;
    await new Promise(r => setTimeout(r, 200));
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
