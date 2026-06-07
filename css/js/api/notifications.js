/**
 * BuyForMe — Notifications API (Supabase)
 */

import { supabase } from "../supabase.js";

const LOCAL_FALLBACK_PREFIX = "bfm_notif_fallback_";

/** @returns {boolean} */
export function isNotificationsTableAvailable() {
  return !window.__bfmNotifTableMissing;
}

function markTableMissing() {
  window.__bfmNotifTableMissing = true;
}

function localKey(userId) {
  return `${LOCAL_FALLBACK_PREFIX}${userId}`;
}

/** @param {string} userId */
function readLocalFallback(userId) {
  try {
    return JSON.parse(localStorage.getItem(localKey(userId)) || "[]");
  } catch {
    return [];
  }
}

/** @param {string} userId @param {object[]} items */
function writeLocalFallback(userId, items) {
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(items.slice(0, 50)));
  } catch { /* ignore */ }
}

/**
 * @param {string} userId
 * @param {number} [limit=50]
 */
export async function fetchNotifications(userId, limit = 50) {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (/relation.*does not exist|42P01/i.test(error.message || "")) {
      markTableMissing();
    }
    return readLocalFallback(userId);
  }

  return (data || []).map(normalizeRow);
}

/**
 * @param {string} userId
 * @param {{ type?: string, title?: string, body: string, link?: string, metadata?: object }} payload
 */
export async function createNotification(userId, payload) {
  const row = {
    user_id: userId,
    type: payload.type || "info",
    title: payload.title || null,
    body: payload.body,
    link: payload.link || null,
    metadata: payload.metadata || {},
  };

  const { data, error } = await supabase
    .from("notifications")
    .insert(row)
    .select()
    .single();

  if (error) {
    if (/relation.*does not exist|42P01/i.test(error.message || "")) {
      markTableMissing();
    }
    const local = readLocalFallback(userId);
    const item = normalizeRow({
      id: `local-${Date.now()}`,
      body: payload.body,
      title: payload.title,
      type: payload.type || "info",
      link: payload.link,
      created_at: new Date().toISOString(),
      is_read: false,
    });
    local.unshift(item);
    writeLocalFallback(userId, local);
    return item;
  }

  return normalizeRow(data);
}

/** @param {string} userId */
export async function clearAllNotifications(userId) {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("user_id", userId);

  if (error && !/relation.*does not exist|42P01/i.test(error.message || "")) {
    throw new Error(error.message);
  }

  try {
    localStorage.removeItem(localKey(userId));
  } catch { /* ignore */ }
}

/**
 * Migrate legacy localStorage notifications to server (one-time).
 * @param {string} userId
 * @param {string} legacyKey
 */
export async function migrateLegacyNotifications(userId, legacyKey) {
  if (window.__bfmNotifTableMissing) return;

  let legacy = [];
  try {
    legacy = JSON.parse(localStorage.getItem(legacyKey) || "[]");
  } catch {
    return;
  }
  if (!legacy.length) return;

  for (const item of legacy.slice(0, 20)) {
    await createNotification(userId, {
      body: item.message || item.body || "Notification",
      type: "info",
    });
  }

  try {
    localStorage.removeItem(legacyKey);
  } catch { /* ignore */ }
}

/**
 * @param {string} userId
 * @param {(row: object) => void} onInsert
 */
export function subscribeNotifications(userId, onInsert) {
  return supabase
    .channel(`notifications-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => onInsert(normalizeRow(payload.new))
    )
    .subscribe();
}

/** @param {object} row */
function normalizeRow(row) {
  return {
    id: row.id,
    type: row.type || "info",
    title: row.title || null,
    body: row.body || row.message || "",
    link: row.link || null,
    is_read: !!row.is_read,
    time: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    created_at: row.created_at,
  };
}

export { normalizeRow as normalizeNotification };
