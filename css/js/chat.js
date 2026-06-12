/* =============================================================
   BuyForMe — chat.js
   Messages stored in Supabase; voice/video via WebRTC
   ============================================================= */

import { supabase } from "./supabase.js";
import {
  getConvId,
  getMessagesForPartner,
  getPartnerUidFromMessage,
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
} from "./chat-local.js";
import {
  startOutgoingCall,
  acceptIncomingCall,
  prepareIncomingCallSignaling,
  clearIncomingCallPrep,
  rejectIncomingCall,
} from "./call-webrtc.js";
import {
  unlockSounds,
  playIncomingCallRing,
  stopIncomingCallRing,
  playOutgoingRingback,
  stopOutgoingRingback,
  stopAllCallSounds,
} from "./app-sounds.js";
import { showIncomingCallScreen, hideIncomingCallScreen } from "./call-ui.js";
import { fetchAllPublicShoppers } from "./api/users.js";
import { initBuyerShell } from "./buyer-shell.js";
import { nameWithVerifiedBadge } from "./verified-badge.js";
import { registerBuyerChatHandlers, setActiveChatPartner } from "./buyer-notifications.js";

let currentUser          = null;
let activeConversationId = null;
let activePartner        = null;
let allConversations     = [];
let activeCall           = null;
let pendingIncomingCallType = "video";
let incomingCallKey = null;

let mediaRecorder = null;
let audioChunks   = [];
let isRecording   = false;
let threadMessageIds = new Set();
let refreshConvTimer = null;
/** @type {Map<string, object>} */
let shopperByUid = new Map();

function scheduleRefreshConversations() {
  clearTimeout(refreshConvTimer);
  refreshConvTimer = setTimeout(() => loadConversations(), 120);
}

function normalizeShopperPartner(s) {
  return {
    uid: String(s.uid),
    name: s.name || "Shopper",
    role: "shopper",
    verified: true,
    avatar_url: s.avatar_url || null,
    location: s.location || "",
    rating: s.rating ?? null,
    review_count: s.review_count ?? 0,
    fee: s.fee || "",
    response_time: s.response_time || "",
  };
}

async function loadShopperDirectory() {
  try {
    const data = await fetchAllPublicShoppers();
    shopperByUid = new Map((data || []).map((s) => [String(s.uid), normalizeShopperPartner(s)]));
  } catch (error) {
    console.warn("loadShopperDirectory:", error);
  }
}

function getEnrichedPartner(uid, fallback = null) {
  const key = String(uid);
  const fromDir = shopperByUid.get(key);
  if (fromDir) return { ...fallback, ...fromDir, uid: key };
  return fallback ? { ...fallback, uid: key } : { uid: key, name: "User", role: "user" };
}

function isVerifiedShopper(partner) {
  return Boolean(partner?.verified || shopperByUid.has(String(partner?.uid)));
}

function renderAvatarInto(el, partner) {
  if (!el) return;
  const initial = (partner?.name || "?")[0].toUpperCase();
  if (partner?.avatar_url) {
    el.innerHTML = `<img src="${escapeHtml(partner.avatar_url)}" alt="">`;
    el.classList.add("has-photo");
  } else {
    el.textContent = initial;
    el.classList.remove("has-photo");
  }
}

function partnerSubtitle(partner) {
  if (!isVerifiedShopper(partner)) {
    const role = partner?.role || "User";
    return role.charAt(0).toUpperCase() + role.slice(1);
  }
  const parts = [];
  if (partner.location) parts.push(partner.location);
  if (partner.rating && partner.rating !== "New") {
    parts.push(`★ ${partner.rating}`);
  } else if (partner.rating === "New") {
    parts.push("New · Verified");
  } else {
    parts.push("Verified shopper");
  }
  if (partner.response_time) parts.push(partner.response_time);
  return parts.join(" · ");
}

function renderPartnerNameHtml(partner, badgeSize = 16) {
  const name = partner?.name || "Unknown";
  if (isVerifiedShopper(partner)) {
    return nameWithVerifiedBadge(name, { tag: "span", className: "conv-name-verified", size: badgeSize });
  }
  return escapeHtml(name);
}

function renderChatHeader(partner) {
  const link = document.getElementById("chatHeaderProfileLink");
  const avatar = document.getElementById("chatHeaderAvatar");
  const nameEl = document.getElementById("chatHeaderName");
  const subEl = document.getElementById("chatHeaderSub");

  const profileUrl =
    isVerifiedShopper(partner) || partner?.role === "shopper"
      ? `shopper-profile.html?id=${encodeURIComponent(partner.uid)}`
      : null;

  if (link) {
    if (profileUrl) {
      link.href = profileUrl;
      link.hidden = false;
    } else {
      link.removeAttribute("href");
      link.hidden = true;
    }
  }

  renderAvatarInto(avatar, partner);

  if (nameEl) {
    if (isVerifiedShopper(partner)) {
      nameEl.innerHTML = nameWithVerifiedBadge(partner.name || "Shopper", {
        tag: "span",
        className: "chat-header__name-verified",
        size: 18,
      });
    } else {
      nameEl.textContent = partner.name || "User";
    }
  }

  if (subEl) subEl.textContent = partnerSubtitle(partner);
}

function isThreadOpen() {
  const thread = document.getElementById("chatThread");
  return thread && !thread.hidden;
}

function setThreadVisible(visible) {
  const empty = document.getElementById("chatEmptyState");
  const thread = document.getElementById("chatThread");
  const win = document.getElementById("chatWindow");

  if (visible) {
    if (empty) {
      empty.hidden = true;
      empty.style.display = "none";
    }
    if (thread) {
      thread.hidden = false;
      thread.style.display = "flex";
    }
    win?.classList.add("chat-window--open");
  } else {
    if (empty) {
      empty.hidden = false;
      empty.style.display = "";
    }
    if (thread) {
      thread.hidden = true;
      thread.style.display = "none";
    }
    win?.classList.remove("chat-window--open");
  }
}

let chatPageAbort = null;

function bindChatPageEvents() {
  chatPageAbort?.abort();
  chatPageAbort = new AbortController();
  const { signal } = chatPageAbort;

  document.getElementById("messageInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }, { signal });

  document.getElementById("sendBtn")?.addEventListener("click", sendMessage, { signal });

  document.getElementById("convSearch")?.addEventListener("input", (e) => {
    filterConversations(e.target.value.trim());
  }, { signal });

  document.getElementById("convList")?.addEventListener("click", (e) => {
    const item = e.target.closest(".conv-item[data-partner-id]");
    if (!item) return;
    openConversation(item.dataset.partnerId);
  }, { signal });

  document.getElementById("convList")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const item = e.target.closest(".conv-item[data-partner-id]");
    if (!item) return;
    e.preventDefault();
    openConversation(item.dataset.partnerId);
  }, { signal });
}

export async function mountChatPage() {
  setupVoicePlayers();
  bindChatPageEvents();

  const profile = await initBuyerShell("messages", { title: "Messages", chat: true });
  if (!profile) return;
  currentUser = profile;

  registerBuyerChatHandlers({
    onMessage: handleInboxMessage,
    onCallInvite: handleInboxCallInvite,
  });

  await loadShopperDirectory();
  await loadConversations();

  const withUid = new URLSearchParams(window.location.search).get("with");
  if (withUid) await openConversation(withUid);
}

document.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener("click", () => unlockSounds(), { once: true });

  import("./buyer-router.js").then((r) => {
    if (r.shouldAutoMountPage()) mountChatPage();
  });
});

async function handleInboxMessage(msg) {
  const partnerUid = getPartnerUidFromMessage(msg, currentUser.uid);
  const canonicalId = getConvId(currentUser.uid, partnerUid);

  const fromOther = String(msg.sender_id) !== String(currentUser.uid);
  const inOpenThread =
    activePartner &&
    String(activePartner.uid) === partnerUid &&
    isThreadOpen();

  if (
    activePartner &&
    (String(activePartner.uid) === partnerUid || activeConversationId === canonicalId)
  ) {
    activeConversationId = canonicalId;
    appendMessageToThread(msg);
    if (String(msg.receiver_id) === String(currentUser.uid) && !msg.is_read) {
      await markConversationRead(canonicalId, currentUser.uid, partnerUid);
    }
  }

  scheduleRefreshConversations();
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

  allConversations = await getConversationSummaries(currentUser.uid, {
    onUpdate: (conversations) => {
      allConversations = conversations;
      getUnreadMap(currentUser.uid).then((unreadMap) => renderConvList(allConversations, unreadMap));
    },
  });

  if (allConversations.length === 0) {
    list.innerHTML = `<p class="conv-empty">No conversations yet.<br><br>Go to a shopper profile and tap <strong>Message</strong> to start chatting.</p>`;
    return;
  }

  const unreadMap = await getUnreadMap(currentUser.uid);
  renderConvList(allConversations, unreadMap);
}

function renderConvList(conversations, unreadMap = {}) {
  const list = document.getElementById("convList");
  if (!list) return;

  if (conversations.length === 0) {
    list.innerHTML = `<p class="conv-empty">No conversations found.</p>`;
    return;
  }

  list.innerHTML = conversations.map(m => {
    const isMine = String(m.sender_id) === String(currentUser.uid);
    const otherId = m._partner?.uid || (isMine ? m.receiver_id : m.sender_id);
    const partner = getEnrichedPartner(otherId, m._partner);
    const preview = getPreviewText(m.content || "");
    const time = formatTime(m.created_at);
    const canonicalId = getConvId(currentUser.uid, otherId);
    const unread = unreadMap[canonicalId] || unreadMap[m.conversation_id] || 0;
    const isActive = activeConversationId === canonicalId;
    const avatarHtml = partner.avatar_url
      ? `<img src="${escapeHtml(partner.avatar_url)}" alt="">`
      : (partner.name || "?")[0].toUpperCase();
    const avatarClass = partner.avatar_url ? " conv-avatar--photo" : "";
    const locationLine = partner.location
      ? `<p class="conv-location">${escapeHtml(partner.location)}</p>`
      : "";

    return `
      <div class="conv-item ${isActive ? "active" : ""}${unread > 0 ? " has-unread" : ""}" data-partner-id="${escapeHtml(String(otherId))}" role="listitem" tabindex="0">
        <div class="conv-avatar${avatarClass}">${avatarHtml}</div>
        <div class="conv-info">
          <div class="conv-name-row">
            <span class="conv-name">${renderPartnerNameHtml(partner, 14)}</span>
            <span class="conv-time">${time}</span>
          </div>
          ${locationLine}
          <div class="conv-bottom">
            <span class="conv-preview">${isMine ? "You: " : ""}${escapeHtml(preview)}</span>
            ${unread > 0 ? `<span class="conv-unread">${unread}</span>` : ""}
          </div>
        </div>
      </div>`;
  }).join("");
}

async function resolvePartner(otherUid) {
  const key = String(otherUid);
  const fromDir = shopperByUid.get(key);
  if (fromDir) return { ...fromDir };

  const known = allConversations.find(m => {
    const pid = m._partner?.uid || (m.sender_id === currentUser.uid ? m.receiver_id : m.sender_id);
    return String(pid) === key;
  });
  if (known?._partner) {
    const enriched = getEnrichedPartner(key, known._partner);
    if (enriched.name) return enriched;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("with") === key && params.get("name")) {
    return getEnrichedPartner(key, {
      uid: key,
      name: decodeURIComponent(params.get("name")),
      role: "shopper",
    });
  }

  const { data } = await supabase.from("public_shoppers").select("*").eq("uid", key).maybeSingle();
  if (data) {
    const p = normalizeShopperPartner(data);
    shopperByUid.set(key, p);
    return p;
  }

  const { data: user } = await supabase
    .from("users")
    .select("uid, name, role, avatar_url")
    .eq("uid", key)
    .maybeSingle();
  if (user) {
    return {
      uid: key,
      name: user.name,
      role: user.role,
      avatar_url: user.avatar_url || null,
      verified: false,
    };
  }

  return { uid: key, name: "User", role: "user" };
}

window.openConversation = async function (otherUid) {
  if (!currentUser?.uid || !otherUid) return;

  activeConversationId = getConvId(currentUser.uid, otherUid);
  activePartner        = await resolvePartner(otherUid);
  setConversationPartner(activeConversationId, activePartner, currentUser.uid);

  setThreadVisible(true);
  renderChatHeader(activePartner);
  setActiveChatPartner(activePartner.uid);

  const sidebar = document.getElementById("convSidebar");
  if (window.innerWidth <= 900 && sidebar) sidebar.classList.add("is-hidden");

  threadMessageIds = new Set();
  await loadMessages();
  await markAsRead();
  await loadConversations();
  document.dispatchEvent(new CustomEvent("bfm-buyer-badges"));
};

async function loadMessages() {
  if (!activePartner?.uid) return;
  const msgs = await getMessagesForPartner(currentUser.uid, activePartner.uid);
  renderMessages(msgs);
}

function renderMessageBody(content) {
  if (!content) return { type: "text", html: "" };
  if (content.startsWith("[img]")) {
    const url = content.slice(5);
    return {
      type: "image",
      html: `<img src="${escapeHtml(url)}" class="msg-media" alt="Shared image" loading="lazy" onclick="window.open('${escapeHtml(url)}','_blank')">`,
    };
  }
  if (content.startsWith("[audio]")) {
    const url = content.slice(7);
    const bars = Array.from({ length: 14 }, () => "<span></span>").join("");
    return {
      type: "audio",
      html: `
        <div class="msg-voice">
          <button type="button" class="msg-voice__btn" aria-label="Play voice note">
            <i class="fas fa-play msg-voice__icon-play" aria-hidden="true"></i>
            <i class="fas fa-pause msg-voice__icon-pause" aria-hidden="true"></i>
          </button>
          <div class="msg-voice__body">
            <div class="msg-voice__wave" aria-hidden="true">${bars}</div>
            <span class="msg-voice__label">Voice note</span>
          </div>
          <span class="msg-voice__dur">—</span>
          <audio class="msg-voice__audio" preload="metadata" src="${escapeHtml(url)}"></audio>
        </div>`,
    };
  }
  return { type: "text", html: `<p class="msg-text">${escapeHtml(content)}</p>` };
}

function buildMessageRowHtml(m, myUid) {
  if (m.content === "[videocall]incoming" || m.content === "[voicecall]incoming") return "";

  const isMine = String(m.sender_id) === String(myUid);
  const time = formatTime(m.created_at);
  const read = isMine
    ? m.is_read
      ? '<span class="msg-meta__read" aria-label="Read">✓✓</span>'
      : '<span class="msg-meta__read" aria-label="Sent">✓</span>'
    : "";
  const { html: bodyHtml, type } = renderMessageBody(m.content);
  const bubbleClass = isMine ? "bubble-mine" : "bubble-theirs";
  const modClass =
    type === "audio" ? " msg-bubble--voice" : type === "image" ? " msg-bubble--image" : "";
  const rowMod = type === "audio" ? " msg-row--voice" : "";
  const avatar = !isMine
    ? `<div class="msg-avatar" aria-hidden="true">${(m.sender_name || "?")[0].toUpperCase()}</div>`
    : "";
  const idAttr = m.id ? ` data-msg-id="${m.id}"` : "";

  return `
    <div class="msg-row ${isMine ? "mine" : "theirs"}${rowMod}"${idAttr}>
      ${avatar}
      <div class="msg-stack">
        <div class="msg-bubble ${bubbleClass}${modClass}">
          ${bodyHtml}
        </div>
        <div class="msg-meta">
          <span class="msg-meta__time">${time}</span>${read}
        </div>
      </div>
    </div>`;
}

function formatDateDivider(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function formatVoiceDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function bindVoiceDuration(audio) {
  const wrap = audio.closest(".msg-voice");
  const durEl = wrap?.querySelector(".msg-voice__dur");
  if (!durEl || !Number.isFinite(audio.duration)) return;
  durEl.textContent = formatVoiceDuration(audio.duration);
}

let activeVoiceAudio = null;

function setupVoicePlayers() {
  const container = document.getElementById("chatMessages");
  if (!container || container.dataset.voiceBound === "1") return;
  container.dataset.voiceBound = "1";

  container.addEventListener("click", e => {
    const btn = e.target.closest(".msg-voice__btn");
    if (!btn) return;
    const wrap = btn.closest(".msg-voice");
    const audio = wrap?.querySelector(".msg-voice__audio");
    if (!audio) return;

    if (activeVoiceAudio && activeVoiceAudio !== audio) {
      activeVoiceAudio.pause();
      activeVoiceAudio.currentTime = 0;
      activeVoiceAudio.closest(".msg-voice")?.classList.remove("is-playing");
    }

    if (audio.paused) {
      audio.play().catch(() => {});
      wrap.classList.add("is-playing");
      activeVoiceAudio = audio;
    } else {
      audio.pause();
      wrap.classList.remove("is-playing");
      activeVoiceAudio = null;
    }
  });

  container.addEventListener("loadedmetadata", e => {
    if (e.target.matches?.(".msg-voice__audio")) bindVoiceDuration(e.target);
  });

  container.addEventListener("ended", e => {
    if (!e.target.matches?.(".msg-voice__audio")) return;
    e.target.closest(".msg-voice")?.classList.remove("is-playing");
    if (activeVoiceAudio === e.target) activeVoiceAudio = null;
  });
}

function renderMessages(msgs) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  threadMessageIds = new Set((msgs || []).map(m => m.id).filter(Boolean));

  if (msgs.length === 0) {
    container.innerHTML = `<p class="chat-messages__empty">No messages yet.<br>Say hello!</p>`;
    return;
  }

  let lastDate = null;
  container.innerHTML = msgs.map(m => {
    const msgDate = new Date(m.created_at).toDateString();
    let dateDivider = "";
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      dateDivider = `<div class="msg-date-divider">${formatDateDivider(m.created_at)}</div>`;
    }
    return dateDivider + buildMessageRowHtml(m, currentUser.uid);
  }).join("");

  container.querySelectorAll(".msg-voice__audio").forEach(a => {
    if (a.readyState >= 1) bindVoiceDuration(a);
  });

  container.scrollTop = container.scrollHeight;
}

function appendMessageToThread(m) {
  if (!m?.id || threadMessageIds.has(m.id)) return;
  if (m.content === "[videocall]incoming" || m.content === "[voicecall]incoming") return;

  const container = document.getElementById("chatMessages");
  if (!container || !isThreadOpen()) return;

  threadMessageIds.add(m.id);

  const empty = container.querySelector(".chat-messages__empty");
  if (empty) empty.remove();

  const wrap = document.createElement("div");
  wrap.innerHTML = buildMessageRowHtml(m, currentUser.uid);
  const el = wrap.firstElementChild;
  if (!el) return;
  if (m.id) el.dataset.msgId = m.id;
  container.appendChild(el);

  const audio = el.querySelector(".msg-voice__audio");
  if (audio?.readyState >= 1) bindVoiceDuration(audio);

  container.scrollTop = container.scrollHeight;
}

function appendOptimisticMessage(content) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  const empty = container.querySelector(".chat-messages__empty");
  if (empty) empty.remove();

  const fake = {
    sender_id: currentUser.uid,
    content,
    created_at: new Date().toISOString(),
    is_read: false,
  };
  const wrap = document.createElement("div");
  wrap.innerHTML = buildMessageRowHtml(fake, currentUser.uid);
  const el = wrap.firstElementChild;
  if (!el) return;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

window.sendMessage = async function () {
  const input   = document.getElementById("messageInput");
  const content = input?.value.trim();
  if (!content || !activeConversationId || !activePartner) return;

  input.value = "";

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
    const saved = await sendChatMessage(supabase, msg);
    appendMessageToThread(saved);
    scheduleRefreshConversations();
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

    const saved = await sendChatMessage(supabase, msg);
    await loadMessages();
    scheduleRefreshConversations();
  } catch (err) {
    alert(err.message || "Failed to send image.");
  }
};

window.toggleVoiceRecord = async function () {
  if (isRecording) {
    mediaRecorder?.stop();
    isRecording = false;
    const btn = document.getElementById("voiceBtn");
      if (btn) {
        btn.classList.remove("is-recording");
        btn.title = "Voice note";
      }
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
      if (btn) {
        btn.classList.add("is-recording");
        btn.title = "Stop recording";
      }
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
    const saved = await sendChatMessage(supabase, msg);
    await loadMessages();
    scheduleRefreshConversations();
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
  endActiveCall(false);
  playOutgoingRingback();
  try {
    await sendCallInvite(supabase, {
      sender_id:   currentUser.uid,
      sender_name: currentUser.name,
      sender_role: currentUser.role,
      receiver_id: activePartner.uid,
      receiver_name: activePartner.name,
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
  hideIncomingCallScreen();
  await acceptCall("video");
};

window.acceptVoiceCall = async function () {
  hideIncomingCallScreen();
  await acceptCall("voice");
};

async function acceptCall(callType) {
  stopIncomingCallRing();
  stopOutgoingRingback();
  if (activeCall) {
    activeCall.end(false);
    activeCall = null;
  }
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
  hideIncomingCallScreen();
  stopAllCallSounds();
  if (activeCall) {
    try { await activeCall.rejectRemote?.(); } catch {}
    activeCall.end();
    activeCall = null;
  } else {
    await rejectIncomingCall();
  }
};

window.endCall = function () {
  endActiveCall();
};

function endActiveCall(playEndTone = true) {
  stopAllCallSounds();
  activeCall?.end(playEndTone);
  activeCall = null;
  incomingCallKey = null;
  clearIncomingCallPrep();
  hideIncomingCallScreen();
}

async function handleIncomingCall({ sender_id, sender_name, callType }) {
  const type = callType === "voice" ? "voice" : "video";
  const isVideo = type === "video";
  const key = `${sender_id}:${type}`;

  if (incomingCallKey === key) return;
  if (document.getElementById("bfmCallOverlay") || document.getElementById("bfmIncomingCall")) return;

  incomingCallKey = key;
  pendingIncomingCallType = type;

  if (!activePartner || String(activePartner.uid) !== String(sender_id)) {
    activePartner = getEnrichedPartner(sender_id, { uid: sender_id, name: sender_name || "User", role: "user" });
    activeConversationId = getConvId(currentUser.uid, sender_id);
    setConversationPartner(activeConversationId, activePartner, currentUser.uid);
  }

  playIncomingCallRing();

  showIncomingCallScreen({
    partnerName: sender_name,
    callType: type,
    onAccept: () => (isVideo ? acceptVideoCall() : acceptVoiceCall()),
    onDecline: () => rejectCall(),
  });

  prepareIncomingCallSignaling(supabase, currentUser.uid, sender_id, type).catch(e => {
    console.warn("Call pre-connect:", e?.message || e);
  });

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(`Incoming ${isVideo ? "video" : "voice"} call`, {
        body: `${sender_name || "Someone"} is calling you`,
      });
    } catch {}
  }
}

async function markAsRead() {
  if (!activeConversationId || !activePartner?.uid) return;
  await markConversationRead(activeConversationId, currentUser.uid, activePartner.uid);
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
  document.getElementById("convSidebar")?.classList.remove("is-hidden");
  setActiveChatPartner(null);
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
