/* =============================================================
   BuyForMe — chat-local.js
   One thread per user pair (WhatsApp-style). Supabase + realtime.
   ============================================================= */

import { supabase } from "./supabase.js";

export const INBOX_EVENT_MSG  = "chat_msg";
export const INBOX_EVENT_CALL = "call_invite";

const partnerCache = {};
let messagesChannelRef = null;
let inboxChannelRef = null;
/** Reused publish channels — avoids ~1–3s subscribe delay per call/message broadcast */
const inboxPublishChannels = new Map();
const inboxPublishReady = new Set();

export function getConvId(uid1, uid2) {
  return [String(uid1), String(uid2)].sort().join("_");
}

export function getPartnerUidFromConvId(convId, myUserId) {
  const me = String(myUserId);
  for (const part of String(convId).split("_")) {
    if (part && part !== me) return part;
  }
  return null;
}

export function getPartnerUidFromMessage(msg, myUserId) {
  const me = String(myUserId);
  if (String(msg.sender_id) === me) return String(msg.receiver_id);
  return String(msg.sender_id);
}

export function buildMessage(fields) {
  return {
    id: crypto.randomUUID(),
    is_read: false,
    created_at: new Date().toISOString(),
    ...fields,
  };
}

export function isCallSignalContent(content) {
  return /^\[(video|voice)call\](ring|incoming)$/.test(content || "");
}

export function callTypeFromContent(content) {
  return String(content || "").includes("video") ? "video" : "voice";
}

export function getPreviewText(content) {
  if (!content) return "";
  if (content.startsWith("[img]"))       return "📷 Photo";
  if (content.startsWith("[audio]"))     return "🎤 Voice note";
  if (isCallSignalContent(content))      return content.includes("video") ? "📹 Incoming video call" : "📞 Incoming voice call";
  if (content.startsWith("[videocall]")) return "📹 Video call";
  if (content.startsWith("[voicecall]")) return "📞 Voice call";
  return content.length > 36 ? content.substring(0, 36) + "..." : content;
}

function partnerFromRow(m, myUserId) {
  const partnerUid = getPartnerUidFromMessage(m, myUserId);
  const me = String(myUserId);
  const isMine = String(m.sender_id) === me;
  return {
    uid: partnerUid,
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
    avatar_url: partner.avatar_url || null,
    location: partner.location || "",
    rating: partner.rating ?? null,
    verified: Boolean(partner.verified),
  };
}

/** All messages between me and one other user (ignores stale conversation_id in DB). */
export async function getMessagesForPartner(myUserId, partnerUid) {
  const me = String(myUserId);
  const partner = String(partnerUid);
  const canonicalId = getConvId(me, partner);

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${me},receiver_id.eq.${partner}),and(sender_id.eq.${partner},receiver_id.eq.${me})`
    )
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getMessagesForPartner:", error);
    return [];
  }

  return (data || [])
    .filter(m => !isCallSignalContent(m.content))
    .map(m => ({
      ...m,
      conversation_id: canonicalId,
    }));
}

/** @param convId canonical id OR pass partner via getPartnerUidFromConvId */
export async function getMessages(convId, myUserId = null) {
  if (myUserId) {
    const partner = getPartnerUidFromConvId(convId, myUserId);
    if (partner) return getMessagesForPartner(myUserId, partner);
  }
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
    .limit(500);

  if (error) {
    console.error("getConversationSummaries:", error);
    return [];
  }

  const byPartner = new Map();
  for (const m of data || []) {
    if (isCallSignalContent(m.content)) continue;
    const partner = partnerFromRow(m, me);
    if (!partner.uid || partner.uid === me) continue;

    const canonicalId = getConvId(me, partner.uid);
    const cached = partnerCache[canonicalId];
    const row = {
      ...m,
      conversation_id: canonicalId,
      _partner: cached || partner,
    };

    const prev = byPartner.get(partner.uid);
    if (!prev || new Date(row.created_at) > new Date(prev.created_at)) {
      byPartner.set(partner.uid, row);
    }
  }

  return [...byPartner.values()].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
}

export async function getUnreadMap(myUserId) {
  const me = String(myUserId);
  const { data, error } = await supabase
    .from("messages")
    .select("sender_id, receiver_id, is_read")
    .eq("receiver_id", me)
    .eq("is_read", false);

  if (error) return {};

  const map = {};
  for (const m of data || []) {
    if (isCallSignalContent(m.content)) continue;
    const partnerUid = String(m.sender_id);
    const canonicalId = getConvId(me, partnerUid);
    map[canonicalId] = (map[canonicalId] || 0) + 1;
  }
  return map;
}

export async function markConversationRead(convId, myUserId, partnerUid = null) {
  const me = String(myUserId);
  const partner = partnerUid
    ? String(partnerUid)
    : getPartnerUidFromConvId(convId, me);

  let q = supabase.from("messages").update({ is_read: true }).eq("receiver_id", me).eq("is_read", false);
  if (partner) {
    q = q.eq("sender_id", partner);
  } else {
    q = q.eq("conversation_id", convId);
  }
  const { error } = await q;
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
    const blob = await dataUrlToBlob(content.slice(5));
    const url = await uploadChatBlob(blob, {
      userId: message.sender_id,
      convId: message.conversation_id,
      ext: "jpg",
    });
    return "[img]" + url;
  }
  if (content.startsWith("[audio]") && content.length > 500 && content[7] !== "h") {
    const blob = await dataUrlToBlob(content.slice(7));
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
  const senderId = String(message.sender_id);
  const receiverId = String(message.receiver_id);
  const conversationId = getConvId(senderId, receiverId);

  const row = {
    conversation_id: conversationId,
    sender_id: senderId,
    sender_name: message.sender_name || null,
    sender_role: message.sender_role || null,
    receiver_id: receiverId,
    receiver_name: message.receiver_name || null,
    content: message.content,
    is_read: !!message.is_read,
  };

  const { data, error } = await supabase.from("messages").insert(row).select().single();
  if (error) {
    const hint =
      error.message?.includes("bigint") && error.message?.includes("-")
        ? " Run supabase-messages-fix.sql in Supabase (messages.sender_id must be uuid, not bigint)."
        : "";
    throw new Error((error.message || "Could not save message.") + hint);
  }
  return { ...data, conversation_id: conversationId };
}

function dispatchInboxRow(row, myUserId, { onMessage, onCallInvite }) {
  if (!row) return;
  const me = String(myUserId);
  if (String(row.sender_id) !== me && String(row.receiver_id) !== me) return;

  if (isCallSignalContent(row.content)) {
    if (String(row.sender_id) === me) return;
    onCallInvite?.({
      sender_id: row.sender_id,
      sender_name: row.sender_name,
      receiver_id: row.receiver_id,
      callType: callTypeFromContent(row.content),
    });
    return;
  }

  if (!row.content) return;
  onMessage?.({
    ...row,
    conversation_id: getConvId(me, getPartnerUidFromMessage(row, me)),
  });
}

export async function sendChatMessage(supabaseClient, message) {
  const senderId = String(message.sender_id);
  const receiverId = String(message.receiver_id);
  message.conversation_id = getConvId(senderId, receiverId);
  message.content = await prepareMessageContent(message);

  const saved = await insertMessage(message);

  try {
    await broadcastToUser(supabaseClient, receiverId, INBOX_EVENT_MSG, saved);
  } catch (e) {
    console.warn("Live message notify:", e.message);
  }

  return saved;
}

export function subscribeInbox(supabaseClient, userId, { onMessage, onCallInvite }) {
  unsubscribeInbox(supabaseClient);
  const me = String(userId);

  const handlers = { onMessage, onCallInvite };
  const onRow = row => dispatchInboxRow(row, me, handlers);

  messagesChannelRef = supabaseClient
    .channel(`chat_db_${me}`, { config: { broadcast: { self: false } } })
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      ({ new: row }) => onRow(row)
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages" },
      ({ new: row }) => onRow(row)
    )
    .on("broadcast", { event: INBOX_EVENT_MSG }, ({ payload }) => onRow(payload))
    .subscribe(status => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("Chat realtime channel:", status);
      }
    });

  inboxChannelRef = supabaseClient
    .channel(`chat_inbox_${me}`)
    .on("broadcast", { event: INBOX_EVENT_CALL }, ({ payload }) => {
      if (!payload || String(payload.sender_id) === me) return;
      onCallInvite?.(payload);
    })
    .on("broadcast", { event: INBOX_EVENT_MSG }, ({ payload }) => onRow(payload))
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
  inboxPublishChannels.forEach(ch => supabaseClient.removeChannel(ch));
  inboxPublishChannels.clear();
  inboxPublishReady.clear();
}

async function ensureInboxPublishChannel(supabaseClient, receiverId) {
  const targetId = String(receiverId);
  const channelName = `chat_inbox_${targetId}`;

  if (inboxPublishReady.has(channelName)) {
    return inboxPublishChannels.get(channelName);
  }

  let ch = inboxPublishChannels.get(channelName);
  if (!ch) {
    ch = supabaseClient.channel(channelName, {
      config: { broadcast: { ack: false } },
    });
    inboxPublishChannels.set(channelName, ch);
  }

  if (ch.state === "joined") {
    inboxPublishReady.add(channelName);
    return ch;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Could not reach the other user — are they online?"));
    }, 8000);

    ch.subscribe(status => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        inboxPublishReady.add(channelName);
        resolve(ch);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        inboxPublishReady.delete(channelName);
        reject(new Error("Realtime connection failed. Check Supabase Realtime is enabled."));
      }
    });
  });
}

/** Broadcast on the same channel the receiver listens to: chat_inbox_{userId} */
export async function broadcastToUser(supabaseClient, receiverId, event, payload) {
  const ch = await ensureInboxPublishChannel(supabaseClient, receiverId);
  await ch.send({ type: "broadcast", event, payload });
}

export async function sendCallInvite(supabaseClient, payload) {
  const senderId = String(payload.sender_id);
  const receiverId = String(payload.receiver_id);
  const callType = payload.callType === "voice" ? "voice" : "video";
  const ringContent = callType === "video" ? "[videocall]ring" : "[voicecall]ring";

  const invite = {
    sender_id: senderId,
    sender_name: payload.sender_name || "User",
    receiver_id: receiverId,
    receiver_name: payload.receiver_name || null,
    callType,
    conversation_id: getConvId(senderId, receiverId),
  };

  let broadcastOk = false;
  let dbOk = false;

  // DB insert first — postgres_changes often delivers faster than a cold broadcast channel
  try {
    const { error } = await supabaseClient.from("messages").insert({
      conversation_id: invite.conversation_id,
      sender_id: senderId,
      sender_name: invite.sender_name,
      sender_role: payload.sender_role || null,
      receiver_id: receiverId,
      receiver_name: invite.receiver_name,
      content: ringContent,
      is_read: false,
    });
    if (!error) dbOk = true;
  } catch (e) {
    console.warn("Call invite db ping:", e);
  }

  try {
    await broadcastToUser(supabaseClient, receiverId, INBOX_EVENT_CALL, invite);
    broadcastOk = true;
  } catch (e) {
    console.warn("Call invite broadcast:", e.message);
  }

  if (!broadcastOk && !dbOk) {
    throw new Error("Could not notify the other user. They may be offline or Realtime is disabled.");
  }

  return invite;
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

export function consolidateConversations() {}
