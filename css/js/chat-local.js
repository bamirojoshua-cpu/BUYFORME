/* =============================================================
   BuyForMe — chat-local.js
   One conversation per person (WhatsApp-style), keyed by user pair.
   Chat history lives in localStorage; realtime broadcast for live delivery.
   ============================================================= */

export const CHAT_STORAGE_KEY = "buyforme_chat_v1";
export const INBOX_EVENT_MSG  = "chat_msg";
export const INBOX_EVENT_CALL = "call_invite";

export function getConvId(uid1, uid2) {
  return [String(uid1), String(uid2)].sort().join("_");
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

function inferPartnerUid(conv, convId, myUserId, messages) {
  if (conv.partner?.uid) return String(conv.partner.uid);
  const parts = String(convId).split("_");
  const other = parts.find(p => p && p !== String(myUserId));
  if (other) return other;
  const m = (messages || []).find(msg => msg.sender_id !== myUserId) || (messages || [])[0];
  if (!m) return null;
  return String(m.sender_id) === String(myUserId) ? String(m.receiver_id) : String(m.sender_id);
}

/** Merge duplicate threads into one chat per other user. */
export function consolidateConversations(myUserId) {
  if (!myUserId) return;
  const store = loadStore();
  const byPartner = new Map();

  for (const [convId, conv] of Object.entries(store.conversations)) {
    const msgs = [...(conv.messages || [])];
    const partnerUid = inferPartnerUid(conv, convId, myUserId, msgs);

    if (!partnerUid) {
      if (msgs.length === 0) delete store.conversations[convId];
      continue;
    }

    if (!byPartner.has(partnerUid)) {
      byPartner.set(partnerUid, {
        partner: {
          uid: partnerUid,
          name: conv.partner?.name || "User",
          role: conv.partner?.role || "user",
        },
        messages: [],
      });
    }

    const bucket = byPartner.get(partnerUid);
    if (conv.partner?.name) {
      bucket.partner.name = conv.partner.name;
      if (conv.partner.role) bucket.partner.role = conv.partner.role;
    }

    const canonicalId = getConvId(myUserId, partnerUid);
    for (const m of msgs) {
      const copy = { ...m, conversation_id: canonicalId };
      if (!bucket.messages.some(x => x.id === copy.id)) bucket.messages.push(copy);
    }
  }

  const next = {};
  for (const [partnerUid, { partner, messages }] of byPartner) {
    messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const canonicalId = getConvId(myUserId, partnerUid);
    next[canonicalId] = { partner, messages };
  }

  store.conversations = next;
  saveStore(store);
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
  const me = String(myUserId || message.receiver_id || message.sender_id);
  const partnerUid = String(message.sender_id) === me
    ? String(message.receiver_id)
    : String(message.sender_id);
  const canonicalId = getConvId(me, partnerUid);

  message.conversation_id = canonicalId;

  consolidateConversations(me);

  const store = loadStore();
  if (!store.conversations[canonicalId]) {
    store.conversations[canonicalId] = { partner: null, messages: [] };
  }
  const conv = store.conversations[canonicalId];

  if (!conv.partner) {
    conv.partner = {
      uid: partnerUid,
      name: message.sender_id === me ? message.receiver_name : message.sender_name,
      role: message.sender_id === me ? (message.receiver_role || "user") : (message.sender_role || "user"),
    };
  } else {
    conv.partner.uid = partnerUid;
    if (message.receiver_name && conv.partner.uid === message.receiver_id)
      conv.partner.name = message.receiver_name;
    if (message.sender_name && conv.partner.uid === message.sender_id)
      conv.partner.name = message.sender_name;
    if (message.sender_role && conv.partner.uid === message.sender_id)
      conv.partner.role = message.sender_role;
    if (message.receiver_role && conv.partner.uid === message.receiver_id)
      conv.partner.role = message.receiver_role;
  }

  if (!conv.partner.name) conv.partner.name = "User";

  const exists = conv.messages.some(m => m.id === message.id);
  if (!exists) conv.messages.push(message);
  conv.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  saveStore(store);
}

export function setConversationPartner(convId, partner, myUserId) {
  if (!myUserId || !partner?.uid) return;
  const canonicalId = getConvId(myUserId, partner.uid);
  consolidateConversations(myUserId);

  const store = loadStore();
  if (!store.conversations[canonicalId]) {
    store.conversations[canonicalId] = { partner, messages: [] };
  } else {
    store.conversations[canonicalId].partner = { ...store.conversations[canonicalId].partner, ...partner, uid: String(partner.uid) };
  }
  saveStore(store);
}

export function getMessages(convId, myUserId) {
  if (myUserId) consolidateConversations(myUserId);
  return loadStore().conversations[convId]?.messages || [];
}

/** One row per other user (most recent message). */
export function getConversationSummaries(myUserId) {
  consolidateConversations(myUserId);

  const store = loadStore();
  const byPartner = new Map();

  for (const [convId, conv] of Object.entries(store.conversations)) {
    const msgs = conv.messages || [];
    if (msgs.length === 0) continue;

    const partnerUid = conv.partner?.uid || inferPartnerUid(conv, convId, myUserId, msgs);
    if (!partnerUid) continue;

    const last = msgs[msgs.length - 1];
    const canonicalId = getConvId(myUserId, partnerUid);
    const row = {
      ...last,
      conversation_id: canonicalId,
      _partner: {
        uid: partnerUid,
        name: conv.partner?.name || last.sender_name || last.receiver_name || "User",
        role: conv.partner?.role || "user",
      },
    };

    const prev = byPartner.get(partnerUid);
    if (!prev || new Date(row.created_at) > new Date(prev.created_at)) {
      byPartner.set(partnerUid, row);
    }
  }

  return [...byPartner.values()].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
}

export function getUnreadMap(myUserId) {
  consolidateConversations(myUserId);

  const store = loadStore();
  const map = {};

  for (const [convId, conv] of Object.entries(store.conversations)) {
    const partnerUid = conv.partner?.uid || inferPartnerUid(conv, convId, myUserId, conv.messages);
    const canonicalId = partnerUid ? getConvId(myUserId, partnerUid) : convId;
    const n = (conv.messages || []).filter(
      m => String(m.receiver_id) === String(myUserId) && !m.is_read
    ).length;
    if (n > 0) map[canonicalId] = (map[canonicalId] || 0) + n;
  }

  return map;
}

export function markConversationRead(convId, myUserId) {
  consolidateConversations(myUserId);

  const store = loadStore();
  const conv = store.conversations[convId];
  if (!conv) return;

  let changed = false;
  for (const m of conv.messages) {
    if (String(m.receiver_id) === String(myUserId) && !m.is_read) {
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
      if (!payload || String(payload.sender_id) === String(userId)) return;
      saveMessage(payload, userId);
      onMessage?.(payload);
    })
    .on("broadcast", { event: INBOX_EVENT_CALL }, ({ payload }) => {
      if (!payload || String(payload.sender_id) === String(userId)) return;
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
  const senderId = String(message.sender_id);
  const receiverId = String(message.receiver_id);
  message.conversation_id = getConvId(senderId, receiverId);
  saveMessage(message, senderId);
  try {
    const outbound = { ...message, conversation_id: getConvId(senderId, receiverId) };
    await broadcastToUser(supabase, receiverId, INBOX_EVENT_MSG, outbound);
  } catch (e) {
    console.warn("Live delivery failed (saved locally):", e.message);
  }
}

export async function sendCallInvite(supabase, payload) {
  await broadcastToUser(supabase, payload.receiver_id, INBOX_EVENT_CALL, payload);
}
