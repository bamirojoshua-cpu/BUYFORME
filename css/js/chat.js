/* =============================================================
   BuyForMe — chat.js
   ✅ Real-time fix (optimistic send)
   ✅ Image sharing
   ✅ Voice notes
   ✅ Video calling (WebRTC)
   ✅ Voice calling (WebRTC, audio only)
   ============================================================= */

import { supabase } from "./supabase.js";
import {
  getConvId,
  getMessages,
  getConversationSummaries,
  getUnreadMap,
  getPreviewText,
  buildMessage,
  sendChatMessage,
  sendCallInvite,
  markConversationRead,
  setConversationPartner,
  compressImageFile,
  readBlobAsDataUrl,
  subscribeInbox,
} from "./chat-local.js";

let currentUser          = null;
let activeConversationId = null;
let activePartner        = null;
let allConversations     = [];

/* ── Voice note state ── */
let mediaRecorder    = null;
let audioChunks      = [];
let isRecording      = false;

/* ── WebRTC state (shared for both voice & video calls) ── */
let peerConnection   = null;
let localStream      = null;
let signalingChannel = null;
let activeCallType   = null; // "video" or "voice"

const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

/* ─────────────────────────────────────────────
   INIT
───────────────────────────────────────────── */
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "auth.html"; return; }

  const { data: profile } = await supabase
    .from("users").select("*").eq("uid", session.user.id).maybeSingle();
  if (!profile) { window.location.href = "auth.html"; return; }

  currentUser = profile;
  const nav = document.getElementById("navAvatar");
  if (nav) nav.textContent = (currentUser.name || "B")[0].toUpperCase();

  subscribeInbox(supabase, currentUser.uid, {
    onMessage: handleInboxMessage,
    onCallInvite: handleInboxCallInvite,
  });

  await loadConversations();

  const withUid = new URLSearchParams(window.location.search).get("with");
  if (withUid) await openConversation(withUid);
}

function handleInboxMessage(msg) {
  if (msg.content === "[videocall]incoming" || msg.content === "[voicecall]incoming") return;
  const partnerUid = String(msg.sender_id);
  const canonicalId = getConvId(currentUser.uid, partnerUid);
  if (activePartner?.uid === partnerUid || activeConversationId === canonicalId) {
    activeConversationId = canonicalId;
    renderMessages(getMessages(activeConversationId, currentUser.uid));
    markConversationRead(activeConversationId, currentUser.uid);
  }
  loadConversations();
}

function handleInboxCallInvite(payload) {
  handleIncomingCall({
    sender_id: payload.sender_id,
    sender_name: payload.sender_name,
    receiver_id: currentUser.uid,
    content: payload.callType === "video" ? "[videocall]incoming" : "[voicecall]incoming",
  });
}

/* ─────────────────────────────────────────────
   LOAD CONVERSATIONS
───────────────────────────────────────────── */
async function loadConversations() {
  const list = document.getElementById("convList");
  if (!list) return;

  allConversations = getConversationSummaries(currentUser.uid);

  if (allConversations.length === 0) {
    list.innerHTML = `<div class="conv-empty">No conversations yet.<br><br>Go to a shopper's profile and click <strong>Send Message</strong> to start chatting.<br><small style="opacity:0.8">Chats are saved on this device only.</small></div>`;
    return;
  }

  renderConvList(allConversations, getUnreadMap(currentUser.uid));
}

function renderConvList(conversations, unreadMap = {}) {
  const list = document.getElementById("convList");
  if (!list) return;

  if (conversations.length === 0) {
    list.innerHTML = `<div class="conv-empty">No conversations found.</div>`;
    return;
  }

  list.innerHTML = conversations.map(m => {
    const isMine    = m.sender_id === currentUser.uid;
    const partner   = m._partner;
    const otherName = partner?.name || (isMine ? m.receiver_name : m.sender_name);
    const otherId   = partner?.uid  || (isMine ? m.receiver_id   : m.sender_id);
    const preview   = getPreviewText(m.content || "");
    const time      = formatTime(m.created_at);
    const canonicalId = getConvId(currentUser.uid, otherId);
    const unread    = unreadMap[canonicalId] || unreadMap[m.conversation_id] || 0;
    const isActive  = activeConversationId === canonicalId;

    return `
      <div class="conv-item ${isActive ? "active" : ""}" onclick="openConversation('${otherId}')">
        <div class="conv-avatar">${(otherName || "?")[0].toUpperCase()}</div>
        <div class="conv-info">
          <div class="conv-name-row">
            <span class="conv-name">${otherName || "Unknown"}</span>
            <span class="conv-time">${time}</span>
          </div>
          <div class="conv-bottom">
            <span class="conv-preview">${isMine ? "You: " : ""}${escapeHtml(preview)}</span>
            ${unread > 0 ? `<span class="conv-unread">${unread}</span>` : ""}
          </div>
        </div>
      </div>`;
  }).join("");
}

/* ─────────────────────────────────────────────
   OPEN A CONVERSATION
───────────────────────────────────────────── */
async function resolvePartner(otherUid) {
  const known = allConversations.find(m => {
    const pid = m._partner?.uid || (m.sender_id === currentUser.uid ? m.receiver_id : m.sender_id);
    return pid === otherUid;
  });
  if (known?._partner?.name) return known._partner;

  const params = new URLSearchParams(window.location.search);
  if (params.get("with") === otherUid && params.get("name")) {
    return { uid: otherUid, name: decodeURIComponent(params.get("name")), role: "shopper" };
  }

  const { data } = await supabase
    .from("public_shoppers").select("uid, name").eq("uid", otherUid).maybeSingle();
  if (data?.name) return { uid: otherUid, name: data.name, role: "shopper" };

  return { uid: otherUid, name: "User", role: "shopper" };
}

window.openConversation = async function (otherUid) {
  activeConversationId = getConvId(currentUser.uid, otherUid);
  activePartner        = await resolvePartner(otherUid);
  setConversationPartner(activeConversationId, activePartner, currentUser.uid);

  document.getElementById("chatEmptyState").style.display = "none";
  document.getElementById("chatHeader").style.display     = "flex";
  document.getElementById("chatMessages").style.display   = "flex";
  document.getElementById("chatInputRow").style.display   = "flex";

  document.getElementById("chatHeaderAvatar").textContent = (activePartner.name || "?")[0].toUpperCase();
  document.getElementById("chatHeaderName").textContent   = activePartner.name || "Shopper";
  document.getElementById("chatHeaderSub").textContent    = activePartner.role || "shopper";

  const sidebar = document.getElementById("convSidebar");
  if (window.innerWidth <= 640 && sidebar) sidebar.classList.add("hidden");

  loadMessages();
  markAsRead();
  await loadConversations();
};

/* ─────────────────────────────────────────────
   LOAD & RENDER MESSAGES
───────────────────────────────────────────── */
function loadMessages() {
  renderMessages(getMessages(activeConversationId, currentUser.uid));
}

function renderMessages(msgs) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  if (msgs.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:0.85rem;margin:auto;padding:40px">No messages yet.<br>Say hello! 👋</div>`;
    return;
  }

  let lastDate = null;
  container.innerHTML = msgs.map(m => {
    if (m.content === "[videocall]incoming" || m.content === "[voicecall]incoming") return "";

    const isMine    = m.sender_id === currentUser.uid;
    const time      = formatTime(m.created_at);
    const read      = isMine ? (m.is_read ? " ✓✓" : " ✓") : "";
    const msgDate   = new Date(m.created_at).toLocaleDateString();
    let dateDivider = "";
    if (msgDate !== lastDate) { lastDate = msgDate; dateDivider = `<div class="msg-date-divider">${msgDate}</div>`; }

    return `
      ${dateDivider}
      <div class="msg-row ${isMine ? "mine" : "theirs"}">
        ${!isMine ? `<div class="msg-avatar">${(m.sender_name || "?")[0].toUpperCase()}</div>` : ""}
        <div class="msg-bubble ${isMine ? "bubble-mine" : "bubble-theirs"}">
          <div class="msg-content">${renderMessageContent(m.content)}</div>
          <div class="msg-time">${time}${read}</div>
        </div>
      </div>`;
  }).join("");

  container.scrollTop = container.scrollHeight;
}

function renderMessageContent(content) {
  if (!content) return "";
  if (content.startsWith("[img]")) {
    const url = content.slice(5);
    return `<img src="${url}" style="max-width:220px;max-height:220px;border-radius:10px;cursor:pointer;display:block" onclick="window.open('${url}','_blank')" loading="lazy">`;
  }
  if (content.startsWith("[audio]")) {
    const url = content.slice(7);
    return `<audio controls style="max-width:200px;height:36px"><source src="${url}"></audio>`;
  }
  return escapeHtml(content);
}

/* ─────────────────────────────────────────────
   OPTIMISTIC SEND
───────────────────────────────────────────── */
function appendOptimisticMessage(content) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  const empty = container.querySelector("div[style*='padding:40px']");
  if (empty) empty.remove();

  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const row  = document.createElement("div");
  row.className = "msg-row mine";
  row.innerHTML = `
    <div class="msg-bubble bubble-mine">
      <div class="msg-content">${renderMessageContent(content)}</div>
      <div class="msg-time">${time} ✓</div>
    </div>`;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

/* ─────────────────────────────────────────────
   SEND TEXT
───────────────────────────────────────────── */
window.sendMessage = async function () {
  const input   = document.getElementById("messageInput");
  const content = input?.value.trim();
  if (!content || !activeConversationId || !activePartner) return;

  input.value = "";
  appendOptimisticMessage(content);

  const msg = buildMessage({
    conversation_id: activeConversationId,
    sender_id:       currentUser.uid,
    sender_name:     currentUser.name,
    sender_role:     currentUser.role,
    receiver_id:     activePartner.uid,
    receiver_name:   activePartner.name,
    content,
  });

  try {
    await sendChatMessage(supabase, msg);
    await loadConversations();
  } catch (e) {
    console.error("Send error:", e);
  }
};

/* ─────────────────────────────────────────────
   IMAGE UPLOAD
───────────────────────────────────────────── */
window.triggerImageUpload = function () {
  document.getElementById("imageFileInput")?.click();
};

window.handleImageUpload = async function (e) {
  const file = e.target.files?.[0];
  if (!file || !activeConversationId || !activePartner) return;
  e.target.value = "";

  let dataUrl;
  try {
    dataUrl = await compressImageFile(file);
  } catch (e) {
    alert(e.message || "Could not process image.");
    return;
  }

  const content = "[img]" + dataUrl;
  appendOptimisticMessage(content);

  const msg = buildMessage({
    conversation_id: activeConversationId,
    sender_id:       currentUser.uid,
    sender_name:     currentUser.name,
    sender_role:     currentUser.role,
    receiver_id:     activePartner.uid,
    receiver_name:   activePartner.name,
    content,
  });

  try {
    await sendChatMessage(supabase, msg);
    await loadConversations();
  } catch (e) {
    alert(e.message || "Failed to send image.");
  }
};

/* ─────────────────────────────────────────────
   VOICE NOTE
───────────────────────────────────────────── */
window.toggleVoiceRecord = async function () {
  if (isRecording) {
    mediaRecorder?.stop();
    isRecording = false;
    const btn = document.getElementById("voiceBtn");
    if (btn) { btn.style.background = ""; btn.style.color = ""; btn.title = "Record voice note"; }
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks  = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        stream.getTracks().forEach(t => t.stop());
        await uploadAndSendAudio(blob);
      };
      mediaRecorder.start();
      isRecording = true;
      const btn = document.getElementById("voiceBtn");
      if (btn) { btn.style.background = "#e74c3c"; btn.style.color = "#fff"; btn.title = "Click to stop recording"; }
    } catch (err) {
      alert("Microphone access denied.");
    }
  }
};

async function uploadAndSendAudio(blob) {
  if (!activeConversationId || !activePartner) return;

  let dataUrl;
  try {
    dataUrl = await readBlobAsDataUrl(blob);
  } catch {
    alert("Could not save voice note.");
    return;
  }

  const content = "[audio]" + dataUrl;
  appendOptimisticMessage(content);

  const msg = buildMessage({
    conversation_id: activeConversationId,
    sender_id:       currentUser.uid,
    sender_name:     currentUser.name,
    sender_role:     currentUser.role,
    receiver_id:     activePartner.uid,
    receiver_name:   activePartner.name,
    content,
  });

  try {
    await sendChatMessage(supabase, msg);
    await loadConversations();
  } catch (e) {
    alert(e.message || "Failed to send voice note.");
  }
}

/* ─────────────────────────────────────────────
   SHARED CALL LOGIC (video + voice)
───────────────────────────────────────────── */
window.startVideoCall = async function () {
  if (!activePartner) return;
  await openCallUI("video", true);
};

window.startVoiceCall = async function () {
  if (!activePartner) return;
  await openCallUI("voice", true);
};

window.acceptVideoCall = async function () {
  document.getElementById("incomingCallBanner")?.remove();
  await openCallUI("video", false);
};

window.acceptVoiceCall = async function () {
  document.getElementById("incomingCallBanner")?.remove();
  await openCallUI("voice", false);
};

window.rejectCall = function () {
  sendSignal({ type: "reject" });
  document.getElementById("incomingCallBanner")?.remove();
};

window.endCall = function () {
  peerConnection?.close(); peerConnection = null;
  localStream?.getTracks().forEach(t => t.stop()); localStream = null;
  if (signalingChannel) { supabase.removeChannel(signalingChannel); signalingChannel = null; }
  document.getElementById("callOverlay")?.remove();
  activeCallType = null;
};

async function openCallUI(type, isCaller) {
  activeCallType = type;
  const isVideo  = type === "video";

  const overlay = document.createElement("div");
  overlay.id = "callOverlay";
  overlay.innerHTML = `
    <div style="position:fixed;inset:0;background:#111;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px">
      <p style="color:#fff;font-family:'Sora',sans-serif;font-size:1.1rem">${isVideo ? "📹" : "📞"} ${isVideo ? "Video" : "Voice"} Call — ${activePartner.name}</p>
      ${isVideo ? `
      <div style="display:flex;gap:16px">
        <video id="localVideo"  autoplay muted playsinline style="width:200px;border-radius:12px;background:#222"></video>
        <video id="remoteVideo" autoplay       playsinline style="width:320px;border-radius:12px;background:#222"></video>
      </div>` : `
      <div style="width:100px;height:100px;border-radius:50%;background:#1a9e6e;display:flex;align-items:center;justify-content:center;font-size:2.5rem">
        ${(activePartner.name || "?")[0].toUpperCase()}
      </div>
      <p style="color:#aaa;font-size:0.9rem" id="callStatus">${isCaller ? "Calling…" : "Connected"}</p>
      <audio id="remoteAudio" autoplay></audio>`}
      <button onclick="endCall()" style="padding:12px 32px;background:#e74c3c;color:#fff;border:none;border-radius:24px;font-size:0.95rem;cursor:pointer;margin-top:8px">
        ${isVideo ? "End Call" : "🔴 End Call"}
      </button>
    </div>`;
  document.body.appendChild(overlay);

  try {
    localStream = await navigator.mediaDevices.getUserMedia(
      isVideo ? { video: true, audio: true } : { audio: true }
    );
    if (isVideo) document.getElementById("localVideo").srcObject = localStream;
  } catch (err) {
    alert(`${isVideo ? "Camera/" : ""}Microphone access denied.`);
    window.endCall(); return;
  }

  peerConnection = new RTCPeerConnection(ICE_SERVERS);
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

  peerConnection.ontrack = e => {
    if (isVideo) {
      const v = document.getElementById("remoteVideo");
      if (v) v.srcObject = e.streams[0];
    } else {
      const a = document.getElementById("remoteAudio");
      if (a) a.srcObject = e.streams[0];
      const status = document.getElementById("callStatus");
      if (status) status.textContent = "Connected";
    }
  };

  const sigKey = `vc_${activeConversationId}_${type}`;
  if (signalingChannel) supabase.removeChannel(signalingChannel);

  signalingChannel = supabase.channel(sigKey)
    .on("broadcast", { event: "signal" }, async ({ payload }) => {
      if (payload.from === currentUser.uid) return;

      if (payload.type === "offer" && !isCaller) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        sendSignal({ type: "answer", sdp: answer });
      } else if (payload.type === "answer" && isCaller) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      } else if (payload.type === "ice") {
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch {}
      } else if (payload.type === "reject") {
        alert(`${activePartner.name} rejected the call.`);
        window.endCall();
      }
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED" && isCaller) {
        peerConnection.onicecandidate = e => {
          if (e.candidate) sendSignal({ type: "ice", candidate: e.candidate });
        };
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignal({ type: "offer", sdp: offer });

        await sendCallInvite(supabase, {
          sender_id:   currentUser.uid,
          sender_name: currentUser.name,
          receiver_id: activePartner.uid,
          callType:    type,
          conversation_id: activeConversationId,
        });
      }
    });

  if (!isCaller) {
    peerConnection.onicecandidate = e => {
      if (e.candidate) sendSignal({ type: "ice", candidate: e.candidate });
    };
  }
}

function sendSignal(payload) {
  signalingChannel?.send({
    type: "broadcast",
    event: "signal",
    payload: { ...payload, from: currentUser.uid }
  });
}

function handleIncomingCall(msg) {
  const isVideo = msg.content === "[videocall]incoming";
  const isVoice = msg.content === "[voicecall]incoming";
  if (!isVideo && !isVoice) return;
  if (msg.receiver_id !== currentUser.uid) return;

  if (!activePartner || activePartner.uid !== msg.sender_id) {
    activePartner = { uid: msg.sender_id, name: msg.sender_name || "User", role: "user" };
    activeConversationId = getConvId(currentUser.uid, msg.sender_id);
    setConversationPartner(activeConversationId, activePartner, currentUser.uid);
  }

  const type = isVideo ? "video" : "voice";

  // Subscribe to signaling channel ready for when user accepts
  const sigKey = `vc_${getConvId(currentUser.uid, msg.sender_id)}_${type}`;
  if (!signalingChannel) {
    signalingChannel = supabase.channel(sigKey)
      .on("broadcast", { event: "signal" }, ({ payload }) => {
        if (payload.from === currentUser.uid) return;
        if (payload.type === "offer") signalingChannel._pendingOffer = payload;
      }).subscribe();
  }

  document.getElementById("incomingCallBanner")?.remove();

  const banner = document.createElement("div");
  banner.id = "incomingCallBanner";
  banner.innerHTML = `
    <div style="position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1a9e6e;color:#fff;padding:16px 24px;border-radius:16px;z-index:9998;font-family:'Inter',sans-serif;display:flex;align-items:center;gap:16px;box-shadow:0 8px 30px rgba(0,0,0,0.2)">
      <span>${isVideo ? "📹" : "📞"} Incoming ${isVideo ? "video" : "voice"} call from <strong>${msg.sender_name}</strong></span>
      <button onclick="${isVideo ? "acceptVideoCall" : "acceptVoiceCall"}()" style="background:#fff;color:#1a9e6e;border:none;padding:8px 16px;border-radius:20px;font-weight:600;cursor:pointer">Accept</button>
      <button onclick="rejectCall()" style="background:#e74c3c;color:#fff;border:none;padding:8px 16px;border-radius:20px;cursor:pointer">Decline</button>
    </div>`;
  document.body.appendChild(banner);
}

/* ─────────────────────────────────────────────
   MARK AS READ
───────────────────────────────────────────── */
function markAsRead() {
  if (!activeConversationId) return;
  markConversationRead(activeConversationId, currentUser.uid);
  loadMessages();
}

/* ─────────────────────────────────────────────
   SEARCH
───────────────────────────────────────────── */
function filterConversations(query) {
  if (!query) { renderConvList(allConversations); return; }
  const q = query.toLowerCase();
  const filtered = allConversations.filter(m => {
    const isMine    = m.sender_id === currentUser.uid;
    const partner   = m._partner;
    const otherName = partner?.name || (isMine ? m.receiver_name : m.sender_name);
    return (otherName || "").toLowerCase().includes(q) || (m.content || "").toLowerCase().includes(q);
  });
  renderConvList(filtered);
}

/* ─────────────────────────────────────────────
   MOBILE
───────────────────────────────────────────── */
window.showConvList = function () {
  document.getElementById("convSidebar")?.classList.remove("hidden");
};

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
function formatTime(ts) {
  const d = new Date(ts), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function escapeHtml(text) {
  return (text || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* ─────────────────────────────────────────────
   DOM READY
───────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  init();

  document.getElementById("messageInput")?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  document.getElementById("sendBtn")?.addEventListener("click", sendMessage);

  document.getElementById("convSearch")?.addEventListener("input", e => {
    filterConversations(e.target.value.trim());
  });
});