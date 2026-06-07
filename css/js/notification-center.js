/**
 * BuyForMe — Shared notification center (buyer + shopper)
 */

import {
  fetchNotifications,
  createNotification,
  clearAllNotifications,
  migrateLegacyNotifications,
  subscribeNotifications,
} from "./api/notifications.js";
import { escapeHtml, formatDate } from "./ui/index.js";
import { supabase } from "./supabase.js";

/** @type {object|null} */
let config = null;
/** @type {object[]} */
let cache = [];
let realtimeChannel = null;

/**
 * @param {{
 *   userId: string,
 *   legacyStorageKey?: string,
 *   listId: string,
 *   dotSelectors?: string[],
 *   emptyHtml?: string,
 * }} options
 */
export async function initNotificationCenter(options) {
  config = options;

  try {
    cache = await fetchNotifications(options.userId);
  } catch (e) {
    console.warn("fetchNotifications:", e);
    cache = [];
  }

  if (options.legacyStorageKey) {
    migrateLegacyNotifications(options.userId, options.legacyStorageKey)
      .then(() => fetchNotifications(options.userId))
      .then((rows) => {
        cache = rows;
        updateNotificationDot();
      })
      .catch((e) => console.warn("Notification migration:", e));
  }

  updateNotificationDot();

  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = subscribeNotifications(options.userId, (row) => {
    if (cache.some((n) => n.id === row.id)) return;
    cache.unshift(row);
    cache = cache.slice(0, 50);
    updateNotificationDot();
    if (document.getElementById(options.listId)?.closest(".is-open, [class*='is-open']")) {
      renderNotificationList(options.listId);
    }
  });
}

/**
 * @param {string} body
 * @param {{ type?: string, title?: string, link?: string, metadata?: object }} [meta]
 */
export async function pushNotification(body, meta = {}) {
  if (!config?.userId) return null;

  const row = await createNotification(config.userId, {
    body,
    type: meta.type || "info",
    title: meta.title,
    link: meta.link,
    metadata: meta.metadata,
  });

  if (!cache.some((n) => n.id === row.id)) {
    cache.unshift(row);
    cache = cache.slice(0, 50);
  }

  updateNotificationDot();
  const list = document.getElementById(config.listId);
  if (list && list.closest(".is-open, [class*='is-open']")) {
    renderNotificationList(config.listId);
  }

  return row;
}

export function getNotificationCache() {
  return cache;
}

export function updateNotificationDot() {
  const selectors = config?.dotSelectors || [];
  const show = cache.length > 0;
  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((dot) => {
      dot.classList.toggle("show", show);
    });
  });
}

function formatNotifTime(ts) {
  const d = new Date(typeof ts === "number" ? ts : ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function iconForType(type) {
  const map = {
    order: "fa-box",
    message: "fa-message",
    system: "fa-bullhorn",
  };
  return map[type] || "fa-bell";
}

/**
 * @param {string} listId
 */
export function renderNotificationList(listId) {
  const list = document.getElementById(listId);
  if (!list) return;

  if (cache.length === 0) {
    list.innerHTML =
      config?.emptyHtml ||
      `<div class="notif-empty">
        <div class="notif-empty-icon"><i class="fas fa-bell-slash" aria-hidden="true"></i></div>
        <p>You're all caught up</p>
        <span>New activity will show up here</span>
      </div>`;
    return;
  }

  list.innerHTML = cache
    .map(
      (item) => `
    <article class="notif-item${item.link ? " notif-item--link" : ""}"${item.link ? ` data-href="${escapeHtml(item.link)}"` : ""}>
      <div class="notif-item-icon"><i class="fas ${iconForType(item.type)}" aria-hidden="true"></i></div>
      <div class="notif-item-body">
        ${item.title ? `<strong>${escapeHtml(item.title)}</strong>` : ""}
        <p>${escapeHtml(item.body)}</p>
        <time>${formatNotifTime(item.time || item.created_at)}</time>
      </div>
    </article>`
    )
    .join("");

  list.querySelectorAll(".notif-item[data-href]").forEach((el) => {
    el.addEventListener("click", () => {
      const href = el.getAttribute("data-href");
      if (href) window.location.assign(href);
    });
  });
}

export async function clearNotificationCenter() {
  if (!config?.userId) return;
  await clearAllNotifications(config.userId);
  cache = [];
  updateNotificationDot();
  renderNotificationList(config.listId);
}

export function stopNotificationCenter() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  config = null;
  cache = [];
}
