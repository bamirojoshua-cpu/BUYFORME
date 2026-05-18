/* =============================================================
   BuyForMe — chat-local.js
   Chat persisted in Supabase (messages table + chat-media storage).
   Realtime via postgres_changes; call invites via broadcast.
   ============================================================= */

import { supabase } from "./supabase.js";

export const INBOX_EVENT_CALL = "call_invite";

const partnerCache = {};
let messagesChannelRef = null;

export function getConvId(uid1, uid2) {
  return [String(uid1), String(uid2)].sort().join("_");
}

export function buildMessage(fields) {
  return {
    id: crypto.randomUUID(),
    is_read: false,
    created_at: new Date().toISOString(),
    ...fields,
  };
}

export function getPreviewText(content) {
  if (!content) return "";
  if (content.startsWith("[img]"))       return "📷 Photo";
  if (content.startsWith("[audio]"))     return "🎤 Voice note";
  if (content.startsWith("[videocall]")) return "📹 Video call";
  if (content.startsWith("[voicecall]")) return "📞 Voice call";
  return content.length > 36 ? content.substring(0, 36) + "..." : content;
}

function partnerFromRow(m, myUserId) {
  const me = String(myUserId);
  const isMine = String(m.sender_id) === me;
  return {
    uid: isMine ? String(m.receiver_id) : String(m.sender_id),
    name: isMine ? (m.receiver_name || "User") : (m.sender_name || "User"),
    role: isMine ? "user" : (m.sender_role || "user"),
  };
}

export function setConversationPartner(convId, partner, myUserId) {
  if (!partner?.uid) return;
  const canonicalId = getConvId(myUserId, partner.uid);
  partnerCache[canonicalId] = {
    uid: String(partner.uid),
    name: partner.name || "User",
    role: partner.role || "user",
  };
}

export async function getMessages(convId) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getMessages:", error);
    return [];
  }
  return data || [];
}

export async function getConversationSummaries(myUserId) {
  const me = String(myUserId);
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .or(`sender_id.eq.${me},receiver_id.eq.${me}`)
    .order("created_at", { ascending: false })
    .limit(400);

  if (error) {
    console.error("getConversationSummaries:", error);
    return [];
  }

  const byPartner = new Map();
  for (const m of data || []) {
    const partner = partnerFromRow(m, me);
    const canonicalId = getConvId(me, partner.uid);
    const cached = partnerCache[canonicalId];
    const row = {
      ...m,
      conversation_id: canonicalId,
      _partner: cached || partner,
    };
    if (!byPartner.has(partner.uid)) byPartner.set(partner.uid, row);
  }

  return [...byPartner.values()].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
}

export async function getUnreadMap(myUserId) {
  const me = String(myUserId);
  const { data, error } = await supabase
    .from("messages")
    .select("conversation_id, receiver_id, is_read")
    .eq("receiver_id", me)
    .eq("is_read", false);

  if (error) return {};

  const map = {};
  for (const m of data || []) {
    map[m.conversation_id] = (map[m.conversation_id] || 0) + 1;
  }
  return map;
}

export async function markConversationRead(convId, myUserId) {
  const me = String(myUserId);
  const { error } = await supabase
    .from("messages")
    .update({ is_read: true })
    .eq("conversation_id", convId)
    .eq("receiver_id", me)
    .eq("is_read", false);

  if (error) console.error("markConversationRead:", error);
}

export async function uploadChatBlob(blob, { userId, convId, ext }) {
  const safeExt = (ext || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  const path = `${convId}/${userId}_${Date.now()}.${safeExt}`;
  const { error } = await supabase.storage
    .from("chat-media")
    .upload(path, blob, { contentType: blob.type || "application/octet-stream", upsert: false });

  if (error) throw new Error(error.message || "Upload failed — run supabase-chat-media.sql in Supabase.");

  const { data } = supabase.storage.from("chat-media").getPublicUrl(path);
  return data.publicUrl;
}

export async function prepareMessageContent(message) {
  const content = message.content || "";
  if (content.startsWith("[img]") && content.length > 500 && content[5] !== "h") {
    const dataUrl = content.slice(5);
    const blob = await dataUrlToBlob(dataUrl);
    const url = await uploadChatBlob(blob, {
      userId: message.sender_id,
      convId: message.conversation_id,
      ext: "jpg",
    });
    return "[img]" + url;
  }
  if (content.startsWith("[audio]") && content.length > 500 && content[7] !== "h") {
    const dataUrl = content.slice(7);
    const blob = await dataUrlToBlob(dataUrl);
    const url = await uploadChatBlob(blob, {
      userId: message.sender_id,
      convId: message.conversation_id,
      ext: "webm",
    });
    return "[audio]" + url;
  }
  return content;
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function insertMessage(message) {
  const row = {
    id: message.id,
    conversation_id: message.conversation_id,
    sender_id: message.sender_id,
    sender_name: message.sender_name,
    sender_role: message.sender_role,
    receiver_id: message.receiver_id,
    receiver_name: message.receiver_name,
    content: message.content,
    is_read: !!message.is_read,
    created_at: message.created_at,
  };

  const { error } = await supabase.from("messages").insert(row);
  if (error) throw new Error(error.message || "Could not save message.");
  return row;
}

export async function sendChatMessage(_supabaseClient, message) {
  const senderId = String(message.sender_id);
  const receiverId = String(message.receiver_id);
  message.conversation_id = getConvId(senderId, receiverId);

  message.content = await prepareMessageContent(message);
  await insertMessage(message);
}

let inboxChannelRef = null;

export function subscribeInbox(supabaseClient, userId, { onMessage, onCallInvite }) {
  unsubscribeInbox(supabaseClient);
  const me = String(userId);

  messagesChannelRef = supabaseClient
    .channel(`chat_db_${me}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${me}` },
      ({ new: row }) => {
        if (!row || String(row.sender_id) === me) return;
        onMessage?.(row);
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `sender_id=eq.${me}` },
      ({ new: row }) => {
        if (!row) return;
        onMessage?.(row);
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages", filter: `sender_id=eq.${me}` },
      ({ new: row }) => {
        if (row) onMessage?.(row);
      }
    )
    .subscribe();

  inboxChannelRef = supabaseClient
    .channel(`chat_inbox_${me}`)
    .on("broadcast", { event: INBOX_EVENT_CALL }, ({ payload }) => {
      if (!payload || String(payload.sender_id) === me) return;
      onCallInvite?.(payload);
    })
    .subscribe();

  return { messages: messagesChannelRef, inbox: inboxChannelRef };
}

export function unsubscribeInbox(supabaseClient) {
  if (messagesChannelRef) {
    supabaseClient.removeChannel(messagesChannelRef);
    messagesChannelRef = null;
  }
  if (inboxChannelRef) {
    supabaseClient.removeChannel(inboxChannelRef);
    inboxChannelRef = null;
  }
}

export async function broadcastToUser(supabaseClient, receiverId, event, payload) {
  const ch = supabaseClient.channel(`chat_inbox_${receiverId}_tx_${Date.now()}`);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      supabaseClient.removeChannel(ch);
      reject(new Error("Could not reach the other user right now."));
    }, 8000);

    ch.subscribe(status => {
      if (status === "SUBSCRIBED") {
        ch.send({ type: "broadcast", event, payload })
          .then(() => {
            clearTimeout(timeout);
            setTimeout(() => {
              supabaseClient.removeChannel(ch);
              resolve();
            }, 80);
          })
          .catch(err => {
            clearTimeout(timeout);
            supabaseClient.removeChannel(ch);
            reject(err);
          });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        supabaseClient.removeChannel(ch);
        reject(new Error("Could not reach the other user right now."));
      }
    });
  });
}

export async function sendCallInvite(supabaseClient, payload) {
  try {
    await broadcastToUser(supabaseClient, payload.receiver_id, INBOX_EVENT_CALL, payload);
  } catch (e) {
    console.warn("Call invite delivery:", e.message);
  }
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

export async function compressImageToBlob(file, maxDim = 1200, quality = 0.82) {
  const dataUrl = await compressImageFile(file, maxDim, quality);
  return dataUrlToBlob(dataUrl);
}

export function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** @deprecated local-only helper — no-op for DB chat */
export function consolidateConversations() {}
