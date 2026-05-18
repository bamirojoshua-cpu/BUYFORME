/* =============================================================
   BuyForMe — chat-local.js
   Chat history lives in the browser (localStorage).
   Supabase Realtime broadcast delivers messages live only —
   nothing is written to the messages table or chat-media bucket.
   ============================================================= */

export const CHAT_STORAGE_KEY = "buyforme_chat_v1";
export const INBOX_EVENT_MSG  = "chat_msg";
export const INBOX_EVENT_CALL = "call_invite";

export function getConvId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY)) || { conversations: {} };
  } catch {
    return { conversations: {} };
  }
}

function saveStore(store) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.error("Chat storage full or unavailable:", e);
    throw new Error("Could not save message — browser storage may be full. Try clearing old chats or using smaller images.");
  }
}

export function buildMessage(fields) {
  return {
    id: crypto.randomUUID(),
    is_read: false,
    created_at: new Date().toISOString(),
    ...fields,
  };
}

export function saveMessage(message, myUserId = null) {
  const store = loadStore();
  const convId = message.conversation_id;
  if (!store.conversations[convId]) {
    store.conversations[convId] = { partner: null, messages: [] };
  }
  const conv = store.conversations[convId];

  if (!conv.partner) {
    if (myUserId) {
      const otherUid = message.sender_id === myUserId ? message.receiver_id : message.sender_id;
      conv.partner = {
        uid: otherUid,
        name: message.sender_id === myUserId ? message.receiver_name : message.sender_name,
        role: message.sender_id === myUserId ? (message.receiver_role || "user") : (message.sender_role || "user"),
      };
    } else {
      conv.partner = {
        uid: message.sender_id,
        name: message.sender_name || "User",
        role: message.sender_role || "user",
      };
    }
  } else {
    if (message.receiver_name && conv.partner.uid === message.receiver_id)
      conv.partner.name = message.receiver_name;
    if (message.sender_name && conv.partner.uid === message.sender_id)
      conv.partner.name = message.sender_name;
  }

  const exists = conv.messages.some(m => m.id === message.id);
  if (!exists) conv.messages.push(message);
  conv.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  saveStore(store);
}

export function setConversationPartner(convId, partner) {
  const store = loadStore();
  if (!store.conversations[convId]) {
    store.conversations[convId] = { partner, messages: [] };
  } else {
    store.conversations[convId].partner = partner;
  }
  saveStore(store);
}

export function getMessages(convId) {
  return loadStore().conversations[convId]?.messages || [];
}

export function getConversationSummaries(myUserId) {
  const store = loadStore();
  const summaries = [];

  for (const [convId, conv] of Object.entries(store.conversations)) {
    const msgs = conv.messages || [];
    if (msgs.length === 0) continue;
    const last = msgs[msgs.length - 1];
    summaries.push({ ...last, conversation_id: convId, _partner: conv.partner });
  }

  summaries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return summaries;
}

export function getUnreadMap(myUserId) {
  const store = loadStore();
  const map = {};
  for (const [convId, conv] of Object.entries(store.conversations)) {
    const n = (conv.messages || []).filter(
      m => m.receiver_id === myUserId && !m.is_read
    ).length;
    if (n > 0) map[convId] = n;
  }
  return map;
}

export function markConversationRead(convId, myUserId) {
  const store = loadStore();
  const conv = store.conversations[convId];
  if (!conv) return;
  let changed = false;
  for (const m of conv.messages) {
    if (m.receiver_id === myUserId && !m.is_read) {
      m.is_read = true;
      changed = true;
    }
  }
  if (changed) saveStore(store);
}

export function getPreviewText(content) {
  if (!content) return "";
  if (content.startsWith("[img]"))       return "📷 Photo";
  if (content.startsWith("[audio]"))     return "🎤 Voice note";
  if (content.startsWith("[videocall]")) return "📹 Video call";
  if (content.startsWith("[voicecall]")) return "📞 Voice call";
  return content.length > 36 ? content.substring(0, 36) + "..." : content;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function compressImageFile(file, maxDim = 1200, quality = 0.82) {
  if (!file.type.startsWith("image/")) return readFileAsDataUrl(file);

  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  width  = Math.round(width * scale);
  height = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
  return readFileAsDataUrl(blob);
}

export function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* ── Realtime inbox (ephemeral delivery, not stored on server) ── */
let inboxChannelRef = null;

export function subscribeInbox(supabase, userId, { onMessage, onCallInvite }) {
  if (inboxChannelRef) supabase.removeChannel(inboxChannelRef);

  inboxChannelRef = supabase
    .channel(`chat_inbox_${userId}`)
    .on("broadcast", { event: INBOX_EVENT_MSG }, ({ payload }) => {
      if (!payload || payload.sender_id === userId) return;
      saveMessage(payload);
      onMessage?.(payload);
    })
    .on("broadcast", { event: INBOX_EVENT_CALL }, ({ payload }) => {
      if (!payload || payload.sender_id === userId) return;
      onCallInvite?.(payload);
    })
    .subscribe();

  return inboxChannelRef;
}

export function unsubscribeInbox(supabase) {
  if (inboxChannelRef) {
    supabase.removeChannel(inboxChannelRef);
    inboxChannelRef = null;
  }
}

export async function broadcastToUser(supabase, receiverId, event, payload) {
  const ch = supabase.channel(`chat_inbox_${receiverId}_tx_${Date.now()}`);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      supabase.removeChannel(ch);
      reject(new Error("Message delivery timed out — is the other person online?"));
    }, 8000);

    ch.subscribe(status => {
      if (status === "SUBSCRIBED") {
        ch.send({ type: "broadcast", event, payload })
          .then(() => {
            clearTimeout(timeout);
            setTimeout(() => {
              supabase.removeChannel(ch);
              resolve();
            }, 80);
          })
          .catch(err => {
            clearTimeout(timeout);
            supabase.removeChannel(ch);
            reject(err);
          });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        supabase.removeChannel(ch);
        reject(new Error("Could not reach the other user right now."));
      }
    });
  });
}

export async function sendChatMessage(supabase, message) {
  saveMessage(message, message.sender_id);
  try {
    await broadcastToUser(supabase, message.receiver_id, INBOX_EVENT_MSG, message);
  } catch (e) {
    console.warn("Live delivery failed (saved locally):", e.message);
  }
}

export async function sendCallInvite(supabase, payload) {
  await broadcastToUser(supabase, payload.receiver_id, INBOX_EVENT_CALL, payload);
}
