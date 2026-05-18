/* =============================================================
   BuyForMe — chat.js
   ✅ Real-time fix (optimistic send)
   ✅ Image sharing
   ✅ Voice notes
   ✅ Video calling (WebRTC)
   ✅ Voice calling (WebRTC, audio only)
   ============================================================= */

import { supabase } from "./supabase.js";

let currentUser          = null;
let activeConversationId = null;
let activePartner        = null;
let realtimeChannel      = null;
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

function getConvId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

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

  await loadConversations();

  const withUid = new URLSearchParams(window.location.search).get("with");
  if (withUid) await openConversation(withUid);

  initGlobalListener();
}

/* ─────────────────────────────────────────────
   LOAD CONVERSATIONS
───────────────────────────────────────────── */
async function loadConversations() {
  const { data: msgs } = await supabase
    .from("messages").select("*")
    .or(`sender_id.eq.${currentUser.uid},receiver_id.eq.${currentUser.uid}`)
    .order("created_at", { ascending: false });

  const list = document.getElementById("convList");
  if (!list) return;

  if (!msgs || msgs.length === 0) {
    list.innerHTML = `<div class="conv-empty">No conversations yet.<br><br>Go to a shopper's profile and click <strong>Send Message</strong> to start chatting.</div>`;
    allConversations = [];
    return;
  }

  const seen = {};
  msgs.forEach(m => { if (!seen[m.conversation_id]) seen[m.conversation_id] = m; });
  allConversations = Object.values(seen);

  const unreadMap = {};
  msgs.forEach(m => {
    if (m.receiver_id === currentUser.uid && !m.is_read)
      unreadMap[m.conversation_id] = (unreadMap[m.conversation_id] || 0) + 1;
  });

  renderConvList(allConversations, unreadMap);
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
    const otherName = isMine ? m.receiver_name : m.sender_name;
    const otherId   = isMine ? m.receiver_id   : m.sender_id;
    const preview   = getPreviewText(m.content || "");
    const time      = formatTime(m.created_at);
    const unread    = unreadMap[m.conversation_id] || 0;
    const isActive  = activeConversationId === m.conversation_id;

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

function getPreviewText(content) {
  if (content.startsWith("[img]"))        return "📷 Photo";
  if (content.startsWith("[audio]"))      return "🎤 Voice note";
  if (content.startsWith("[videocall]"))  return "📹 Video call";
  if (content.startsWith("[voicecall]"))  return "📞 Voice call";
  return content.length > 36 ? content.substring(0, 36) + "..." : content;
}

/* ─────────────────────────────────────────────
   OPEN A CONVERSATION
───────────────────────────────────────────── */
window.openConversation = async function (otherUid) {
  // With RLS enabled, we cannot fetch arbitrary users here.
  // Instead, derive partner metadata from existing messages (stored in messages table),
  // and fall back to placeholders until we load the thread.
  const known = allConversations.find(m => {
    const isMine  = m.sender_id === currentUser.uid;
    const otherId = isMine ? m.receiver_id : m.sender_id;
    return otherId === otherUid;
  });

  const isMine    = known ? (known.sender_id === currentUser.uid) : false;
  const otherName = known ? (isMine ? known.receiver_name : known.sender_name) : "User";
  const otherRole = (() => {
    // Prefer role from a message that the other user sent
    const sentByOther = allConversations.find(m => m.sender_id === otherUid);
    return (sentByOther?.sender_role) || "user";
  })();

  activePartner        = { uid: otherUid, name: otherName || "User", role: otherRole || "user" };
  activeConversationId = getConvId(currentUser.uid, otherUid);

  document.getElementById("chatEmptyState").style.display = "none";
  document.getElementById("chatHeader").style.display     = "flex";
  document.getElementById("chatMessages").style.display   = "flex";
  document.getElementById("chatInputRow").style.display   = "flex";

  document.getElementById("chatHeaderAvatar").textContent = (activePartner.name || "?")[0].toUpperCase();
  document.getElementById("chatHeaderName").textContent   = activePartner.name || "Shopper";
  document.getElementById("chatHeaderSub").textContent    = activePartner.role || "shopper";

  const sidebar = document.getElementById("convSidebar");
  if (window.innerWidth <= 640 && sidebar) sidebar.classList.add("hidden");

  await loadMessages();
  await markAsRead();
  subscribeToThread();
  await loadConversations();
};

/* ─────────────────────────────────────────────
   LOAD & RENDER MESSAGES
───────────────────────────────────────────── */
async function loadMessages() {
  const { data: msgs } = await supabase
    .from("messages").select("*")
    .eq("conversation_id", activeConversationId)
    .order("created_at", { ascending: true });

  // If we started a conversation from a direct link (?with=),
  // populate partner name/role from the first message we see.
  if (msgs && msgs.length > 0 && activePartner) {
    const first = msgs.find(m => m.sender_id !== currentUser.uid) || msgs[0];
    if (first) {
      const inferredName = (first.sender_id === currentUser.uid) ? first.receiver_name : first.sender_name;
      const inferredRole = first.sender_role;
      if (inferredName) activePartner.name = inferredName;
      if (inferredRole) activePartner.role = inferredRole;
      document.getElementById("chatHeaderAvatar").textContent = (activePartner.name || "?")[0].toUpperCase();
      document.getElementById("chatHeaderName").textContent   = activePartner.name || "User";
      document.getElementById("chatHeaderSub").textContent    = activePartner.role || "user";
    }
  }

  renderMessages(msgs || []);
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

  const { error } = await supabase.from("messages").insert({
    conversation_id: activeConversationId,
    sender_id:       currentUser.uid,
    sender_name:     currentUser.name,
    sender_role:     currentUser.role,
    receiver_id:     activePartner.uid,
    receiver_name:   activePartner.name,
    content,
    is_read: false
  });

  if (error) console.error("Send error:", error);
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

  const ext  = file.name.split(".").pop();
  const path = `chat/${activeConversationId}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("chat-media").upload(path, file, { upsert: false });
  if (upErr) { alert("Image upload failed: " + upErr.message); return; }

  const { data } = supabase.storage.from("chat-media").getPublicUrl(path);
  const url      = data.publicUrl;

  appendOptimisticMessage("[img]" + url);

  await supabase.from("messages").insert({
    conversation_id: activeConversationId,
    sender_id:       currentUser.uid,
    sender_name:     currentUser.name,
    sender_role:     currentUser.role,
    receiver_id:     activePartner.uid,
    receiver_name:   activePartner.name,
    content:         "[img]" + url,
    is_read:         false
  });
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
  const path = `chat/${activeConversationId}/audio_${Date.now()}.webm`;

  const { error: upErr } = await supabase.storage
    .from("chat-media").upload(path, blob, { contentType: "audio/webm" });
  if (upErr) { alert("Audio upload failed: " + upErr.message); return; }

  const { data } = supabase.storage.from("chat-media").getPublicUrl(path);
  appendOptimisticMessage("[audio]" + data.publicUrl);

  await supabase.from("messages").insert({
    conversation_id: activeConversationId,
    sender_id:       currentUser.uid,
    sender_name:     currentUser.name,
    sender_role:     currentUser.role,
    receiver_id:     activePartner.uid,
    receiver_name:   activePartner.name,
    content:         "[audio]" + data.publicUrl,
    is_read:         false
  });
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

        // Notify the other person via DB
        await supabase.from("messages").insert({
          conversation_id: activeConversationId,
          sender_id:       currentUser.uid,
          sender_name:     currentUser.name,
          sender_role:     currentUser.role,
          receiver_id:     activePartner.uid,
          receiver_name:   activePartner.name,
          content:         `[${type}call]incoming`,
          is_read:         false
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
   REALTIME
───────────────────────────────────────────── */
function subscribeToThread() {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);

  realtimeChannel = supabase
    .channel("chat-" + activeConversationId)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "messages",
      filter: `conversation_id=eq.${activeConversationId}`
    }, async (payload) => {
      const msg = payload.new;
      if (msg.content === "[videocall]incoming" || msg.content === "[voicecall]incoming") {
        handleIncomingCall(msg); return;
      }
      if (msg.sender_id !== currentUser.uid) {
        await loadMessages();
        await markAsRead();
      }
      await loadConversations();
    })
    .subscribe();
}

function initGlobalListener() {
  supabase
    .channel("chat-global-" + currentUser.uid)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "messages",
      filter: `receiver_id=eq.${currentUser.uid}`
    }, async (payload) => {
      const msg = payload.new;
      if (msg.content === "[videocall]incoming" || msg.content === "[voicecall]incoming") {
        handleIncomingCall(msg);
      }
      await loadConversations();
    })
    .subscribe();
}

/* ─────────────────────────────────────────────
   MARK AS READ
───────────────────────────────────────────── */
async function markAsRead() {
  if (!activeConversationId) return;
  await supabase.from("messages")
    .update({ is_read: true })
    .eq("conversation_id", activeConversationId)
    .eq("receiver_id", currentUser.uid)
    .eq("is_read", false);
}

/* ─────────────────────────────────────────────
   SEARCH
───────────────────────────────────────────── */
function filterConversations(query) {
  if (!query) { renderConvList(allConversations); return; }
  const q = query.toLowerCase();
  const filtered = allConversations.filter(m => {
    const isMine    = m.sender_id === currentUser.uid;
    const otherName = isMine ? m.receiver_name : m.sender_name;
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