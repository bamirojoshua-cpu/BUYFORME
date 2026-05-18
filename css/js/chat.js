/* =============================================================
   BuyForMe — chat.js
   Messages stored in Supabase; voice/video via WebRTC
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
  compressImageToBlob,
  uploadChatBlob,
  subscribeInbox,
} from "./chat-local.js";
import {
  startOutgoingCall,
  acceptIncomingCall,
  prepareIncomingCallSignaling,
  clearIncomingCallPrep,
} from "./call-webrtc.js";

let currentUser          = null;
let activeConversationId = null;
let activePartner        = null;
let allConversations     = [];
let activeCall           = null;

let mediaRecorder = null;
let audioChunks   = [];
let isRecording   = false;

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

async function handleInboxMessage(msg) {
  if (msg.content === "[videocall]incoming" || msg.content === "[voicecall]incoming") return;
  const partnerUid = String(msg.sender_id) === String(currentUser.uid)
    ? String(msg.receiver_id)
    : String(msg.sender_id);
  const canonicalId = getConvId(currentUser.uid, partnerUid);

  if (activePartner?.uid === partnerUid || activeConversationId === canonicalId) {
    activeConversationId = canonicalId;
    await loadMessages();
    await markConversationRead(activeConversationId, currentUser.uid);
  }
  await loadConversations();
}

function handleInboxCallInvite(payload) {
  handleIncomingCall({
    sender_id: payload.sender_id,
    sender_name: payload.sender_name,
    receiver_id: currentUser.uid,
    callType: payload.callType || "video",
  });
}

async function loadConversations() {
  const list = document.getElementById("convList");
  if (!list) return;

  allConversations = await getConversationSummaries(currentUser.uid);

  if (allConversations.length === 0) {
    list.innerHTML = `<div class="conv-empty">No conversations yet.<br><br>Go to a shopper's profile and click <strong>Send Message</strong> to start chatting.</div>`;
    return;
  }

  const unreadMap = await getUnreadMap(currentUser.uid);
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
    const isMine    = String(m.sender_id) === String(currentUser.uid);
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

async function resolvePartner(otherUid) {
  const known = allConversations.find(m => {
    const pid = m._partner?.uid || (m.sender_id === currentUser.uid ? m.receiver_id : m.sender_id);
    return String(pid) === String(otherUid);
  });
  if (known?._partner?.name) return known._partner;

  const params = new URLSearchParams(window.location.search);
  if (params.get("with") === otherUid && params.get("name")) {
    return { uid: otherUid, name: decodeURIComponent(params.get("name")), role: "shopper" };
  }

  const { data } = await supabase
    .from("public_shoppers").select("uid, name").eq("uid", otherUid).maybeSingle();
  if (data?.name) return { uid: otherUid, name: data.name, role: "shopper" };

  const { data: user } = await supabase.from("users").select("uid, name, role").eq("uid", otherUid).maybeSingle();
  if (user) return { uid: otherUid, name: user.name, role: user.role };

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

  await loadMessages();
  await markAsRead();
  await loadConversations();
};

async function loadMessages() {
  const msgs = await getMessages(activeConversationId);
  renderMessages(msgs);
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

    const isMine  = String(m.sender_id) === String(currentUser.uid);
    const time    = formatTime(m.created_at);
    const read    = isMine ? (m.is_read ? " ✓✓" : " ✓") : "";
    const msgDate = new Date(m.created_at).toLocaleDateString();
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
    return `<img src="${escapeHtml(url)}" style="max-width:220px;max-height:220px;border-radius:10px;cursor:pointer;display:block" onclick="window.open('${escapeHtml(url)}','_blank')" loading="lazy">`;
  }
  if (content.startsWith("[audio]")) {
    const url = content.slice(7);
    return `<audio controls style="max-width:200px;height:36px"><source src="${escapeHtml(url)}"></audio>`;
  }
  return escapeHtml(content);
}

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
    await loadMessages();
    await loadConversations();
  } catch (e) {
    alert(e.message || "Failed to send message.");
  }
};

window.triggerImageUpload = function () {
  document.getElementById("imageFileInput")?.click();
};

window.handleImageUpload = async function (e) {
  const file = e.target.files?.[0];
  if (!file || !activeConversationId || !activePartner) return;
  e.target.value = "";

  try {
    const blob = await compressImageToBlob(file);
    const previewUrl = URL.createObjectURL(blob);
    appendOptimisticMessage("[img]" + previewUrl);

    const url = await uploadChatBlob(blob, {
      userId: currentUser.uid,
      convId: activeConversationId,
      ext: "jpg",
    });

    const msg = buildMessage({
      conversation_id: activeConversationId,
      sender_id:       currentUser.uid,
      sender_name:     currentUser.name,
      sender_role:     currentUser.role,
      receiver_id:     activePartner.uid,
      receiver_name:   activePartner.name,
      content: "[img]" + url,
    });

    await sendChatMessage(supabase, msg);
    await loadMessages();
    await loadConversations();
  } catch (err) {
    alert(err.message || "Failed to send image.");
  }
};

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
      mediaRecorder.ondataavailable = ev => audioChunks.push(ev.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        stream.getTracks().forEach(t => t.stop());
        await uploadAndSendAudio(blob);
      };
      mediaRecorder.start();
      isRecording = true;
      const btn = document.getElementById("voiceBtn");
      if (btn) { btn.style.background = "#e74c3c"; btn.style.color = "#fff"; btn.title = "Click to stop recording"; }
    } catch {
      alert("Microphone access denied.");
    }
  }
};

async function uploadAndSendAudio(blob) {
  if (!activeConversationId || !activePartner) return;

  appendOptimisticMessage("[audio]…");

  try {
    const url = await uploadChatBlob(blob, {
      userId: currentUser.uid,
      convId: activeConversationId,
      ext: "webm",
    });
    const msg = buildMessage({
      conversation_id: activeConversationId,
      sender_id:       currentUser.uid,
      sender_name:     currentUser.name,
      sender_role:     currentUser.role,
      receiver_id:     activePartner.uid,
      receiver_name:   activePartner.name,
      content: "[audio]" + url,
    });
    await sendChatMessage(supabase, msg);
    await loadMessages();
    await loadConversations();
  } catch (e) {
    alert(e.message || "Failed to send voice note.");
  }
}

window.startVideoCall = async function () {
  if (!activePartner) return;
  await startCall("video");
};

window.startVoiceCall = async function () {
  if (!activePartner) return;
  await startCall("voice");
};

async function startCall(callType) {
  endActiveCall();
  try {
    await sendCallInvite(supabase, {
      sender_id:   currentUser.uid,
      sender_name: currentUser.name,
      receiver_id: activePartner.uid,
      callType,
      conversation_id: activeConversationId,
    });
    activeCall = await startOutgoingCall({
      supabase,
      myUserId: currentUser.uid,
      partnerUserId: activePartner.uid,
      partnerName: activePartner.name,
      callType,
    });
  } catch (e) {
    alert(e.message || "Could not start call.");
    endActiveCall();
  }
}

window.acceptVideoCall = async function () {
  document.getElementById("incomingCallBanner")?.remove();
  await acceptCall("video");
};

window.acceptVoiceCall = async function () {
  document.getElementById("incomingCallBanner")?.remove();
  await acceptCall("voice");
};

async function acceptCall(callType) {
  endActiveCall();
  try {
    activeCall = await acceptIncomingCall({
      supabase,
      myUserId: currentUser.uid,
      partnerUserId: activePartner.uid,
      partnerName: activePartner.name,
      callType,
    });
  } catch (e) {
    alert(e.message || "Could not connect call.");
    endActiveCall();
  }
}

window.rejectCall = async function () {
  if (activeCall) await activeCall.rejectRemote?.();
  clearIncomingCallPrep();
  document.getElementById("incomingCallBanner")?.remove();
};

window.endCall = function () {
  endActiveCall();
};

function endActiveCall() {
  activeCall?.end();
  activeCall = null;
  clearIncomingCallPrep();
  document.getElementById("incomingCallBanner")?.remove();
}

async function handleIncomingCall({ sender_id, sender_name, callType }) {
  const type = callType || "video";
  const isVideo = type === "video";

  if (!activePartner || activePartner.uid !== sender_id) {
    activePartner = { uid: sender_id, name: sender_name || "User", role: "user" };
    activeConversationId = getConvId(currentUser.uid, sender_id);
    setConversationPartner(activeConversationId, activePartner, currentUser.uid);
  }

  await prepareIncomingCallSignaling(supabase, currentUser.uid, sender_id, type);

  document.getElementById("incomingCallBanner")?.remove();
  const banner = document.createElement("div");
  banner.id = "incomingCallBanner";
  banner.innerHTML = `
    <div style="position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1a9e6e;color:#fff;padding:16px 24px;border-radius:16px;z-index:9998;font-family:'Inter',sans-serif;display:flex;align-items:center;gap:16px;box-shadow:0 8px 30px rgba(0,0,0,0.2);max-width:95vw;flex-wrap:wrap">
      <span>${isVideo ? "📹" : "📞"} Incoming ${isVideo ? "video" : "voice"} call from <strong>${escapeHtml(sender_name)}</strong></span>
      <button type="button" onclick="${isVideo ? "acceptVideoCall" : "acceptVoiceCall"}()" style="background:#fff;color:#1a9e6e;border:none;padding:8px 16px;border-radius:20px;font-weight:600;cursor:pointer">Accept</button>
      <button type="button" onclick="rejectCall()" style="background:#e74c3c;color:#fff;border:none;padding:8px 16px;border-radius:20px;cursor:pointer">Decline</button>
    </div>`;
  document.body.appendChild(banner);
}

async function markAsRead() {
  if (!activeConversationId) return;
  await markConversationRead(activeConversationId, currentUser.uid);
  await loadMessages();
}

function filterConversations(query) {
  if (!query) { renderConvList(allConversations); return; }
  const q = query.toLowerCase();
  const filtered = allConversations.filter(m => {
    const isMine    = String(m.sender_id) === String(currentUser.uid);
    const partner   = m._partner;
    const otherName = partner?.name || (isMine ? m.receiver_name : m.sender_name);
    return (otherName || "").toLowerCase().includes(q) || (m.content || "").toLowerCase().includes(q);
  });
  renderConvList(filtered);
}

window.showConvList = function () {
  document.getElementById("convSidebar")?.classList.remove("hidden");
};

function formatTime(ts) {
  const d = new Date(ts), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function escapeHtml(text) {
  return (text || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

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
