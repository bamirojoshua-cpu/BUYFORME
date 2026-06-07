/* Buyer notifications — global realtime, bell drawer, badges, browser alerts */

import { supabase } from "./supabase.js";
import {
  subscribeInbox,
  unsubscribeInbox,
  getPartnerUidFromMessage,
  getPreviewText,
  getUnreadMap,
} from "./chat-local.js";
import { playMessageNotification } from "./app-sounds.js";
import {
  initNotificationCenter,
  pushNotification,
  renderNotificationList,
  clearNotificationCenter,
  stopNotificationCenter,
  updateNotificationDot,
} from "./notification-center.js";

const LEGACY_STORAGE_KEY = "bfm_buyer_notifications";

let buyerUser = null;
let toastFn = (msg) => console.log(msg);
let chatHandlers = null;
let ordersChannel = null;
let started = false;
let drawerUiBound = false;

const ORDER_STATUS_MSG = {
  quoted: (p) => `New quote for "${p}" — review in My Orders`,
  accepted: (p) => `Your request for "${p}" was accepted`,
  paid: (p) => `Payment confirmed for "${p}"`,
  purchased: (p) => `Your shopper bought "${p}"`,
  delivering: (p) => `"${p}" is on its way`,
  delivered: (p) => `"${p}" has been delivered`,
};

export function registerBuyerChatHandlers(handlers) {
  chatHandlers = handlers;
}

export function setActiveChatPartner(uid) {
  if (uid) window.__bfmActiveChatPartner = String(uid);
  else delete window.__bfmActiveChatPartner;
}

function isChatThreadOpen(partnerUid) {
  if (!document.body.classList.contains("buyer-app--chat")) return false;
  return String(window.__bfmActiveChatPartner || "") === String(partnerUid);
}

export function buyerNotificationsEnabled() {
  if (!buyerUser) return true;
  return buyerUser.notifications !== false;
}

export async function addBuyerNotification(message, meta = {}) {
  if (!buyerUser?.uid) return;
  await pushNotification(message, { type: meta.type || "info", link: meta.link, title: meta.title });
  updateNotificationDot();
  if (document.getElementById("buyerNotifDrawer")?.classList.contains("is-open")) {
    renderNotificationList("buyerNotifDrawerList");
  }
}

function injectNotifDrawer() {
  if (document.getElementById("buyerNotifDrawer")) return;

  const drawer = document.createElement("div");
  drawer.className = "notif-drawer buyer-notif-drawer";
  drawer.id = "buyerNotifDrawer";
  drawer.setAttribute("aria-hidden", "true");
  drawer.innerHTML = `
    <button type="button" class="notif-drawer-backdrop" id="buyerNotifDrawerBackdrop" aria-label="Close notifications"></button>
    <aside class="notif-drawer-panel" role="dialog" aria-labelledby="buyerNotifDrawerTitle">
      <header class="notif-drawer-header">
        <h2 id="buyerNotifDrawerTitle"><i class="fas fa-bell" aria-hidden="true"></i> Notifications</h2>
        <button type="button" class="notif-drawer-close" id="buyerNotifDrawerClose" aria-label="Close">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </header>
      <div class="notif-drawer-list" id="buyerNotifDrawerList"></div>
      <footer class="notif-drawer-footer">
        <button type="button" class="btn-pill btn-pill--secondary" id="buyerNotifClearBtn" style="width:100%">Clear all</button>
      </footer>
    </aside>`;
  document.body.appendChild(drawer);
}

function initNotifDrawerUi() {
  injectNotifDrawer();
  if (drawerUiBound) return;
  drawerUiBound = true;

  document.getElementById("buyerNotifBell")?.addEventListener("click", openBuyerNotifications);
  document.getElementById("buyerNotifBellMobile")?.addEventListener("click", openBuyerNotifications);
  document.getElementById("buyerNotifDrawerBackdrop")?.addEventListener("click", closeBuyerNotifications);
  document.getElementById("buyerNotifDrawerClose")?.addEventListener("click", closeBuyerNotifications);
  document.getElementById("buyerNotifClearBtn")?.addEventListener("click", async () => {
    await clearNotificationCenter();
    toastFn("Notifications cleared");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeBuyerNotifications();
  });
}

window.openBuyerNotifications = function () {
  renderNotificationList("buyerNotifDrawerList");
  const drawer = document.getElementById("buyerNotifDrawer");
  if (!drawer) return;
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("notif-drawer-open");
};

window.closeBuyerNotifications = function () {
  const drawer = document.getElementById("buyerNotifDrawer");
  if (!drawer) return;
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("notif-drawer-open");
};

async function requestBrowserPermission() {
  if (!buyerNotificationsEnabled()) return;
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  try {
    await Notification.requestPermission();
  } catch { /* ignore */ }
}

function maybeBrowserNotify(title, body) {
  if (!buyerNotificationsEnabled()) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try {
    new Notification(title, { body, icon: "images/logo.png" });
  } catch { /* ignore */ }
}

function onGlobalMessage(msg) {
  if (!buyerUser?.uid || !msg) return;
  const me = String(buyerUser.uid);
  const fromOther = String(msg.sender_id) !== me;
  const partnerUid = getPartnerUidFromMessage(msg, me);
  const inOpenThread = isChatThreadOpen(partnerUid);

  if (fromOther && !inOpenThread) {
    playMessageNotification();
    const name = msg.sender_name || "Shopper";
    const preview = getPreviewText(msg.content || "");
    addBuyerNotification(`Message from ${name}: "${preview}"`, {
      type: "message",
      title: "New message",
      link: `chat.html?partner=${encodeURIComponent(partnerUid)}`,
    });
    toastFn(`New message from ${name}`);
    maybeBrowserNotify(`Message from ${name}`, preview);
    document.dispatchEvent(new CustomEvent("bfm-buyer-badges"));
  }

  chatHandlers?.onMessage?.(msg);
}

function onGlobalCallInvite(payload) {
  chatHandlers?.onCallInvite?.(payload);
}

function subscribeOrders() {
  if (!buyerUser?.uid) return;
  if (ordersChannel) supabase.removeChannel(ordersChannel);

  ordersChannel = supabase
    .channel(`buyer-orders-global-${buyerUser.uid}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "requests",
        filter: `buyer_id=eq.${buyerUser.uid}`,
      },
      (payload) => {
        const updated = payload.new;
        const product = updated.product_name || "your order";
        const msgFn = ORDER_STATUS_MSG[updated.status];
        if (msgFn && buyerNotificationsEnabled()) {
          const text = msgFn(product);
          addBuyerNotification(text, {
            type: "order",
            title: "Order update",
            link: `tracking.html?order_id=${encodeURIComponent(updated.id)}`,
          });
          toastFn(text);
          maybeBrowserNotify("Order update", text);
        }
        document.dispatchEvent(new CustomEvent("bfm-order-updated", { detail: updated }));
        document.dispatchEvent(new CustomEvent("bfm-buyer-badges"));
      }
    )
    .subscribe();
}

export async function refreshBuyerBadges() {
  if (!buyerUser?.uid) return { orders: 0, messages: 0 };

  const [{ count: pendingOrders }, unreadMap] = await Promise.all([
    supabase
      .from("requests")
      .select("*", { count: "exact", head: true })
      .eq("buyer_id", buyerUser.uid)
      .in("status", ["accepted", "delivering"]),
    getUnreadMap(buyerUser.uid),
  ]);

  const unreadMessages = Object.values(unreadMap || {}).reduce((a, b) => a + b, 0);
  return {
    orders: pendingOrders || 0,
    messages: unreadMessages,
  };
}

/**
 * @param {object} user — buyer profile from users table
 * @param {{ toast?: (msg: string) => void }} options
 */
export async function initBuyerNotifications(user, options = {}) {
  if (!user?.uid) return;
  buyerUser = user;
  if (options.toast) toastFn = options.toast;

  initNotifDrawerUi();

  await initNotificationCenter({
    userId: buyerUser.uid,
    legacyStorageKey: LEGACY_STORAGE_KEY,
    listId: "buyerNotifDrawerList",
    dotSelectors: ["#buyerNotifDot", "#buyerNotifDotMobile"],
    emptyHtml: `
      <div class="notif-empty">
        <div class="notif-empty-icon"><i class="fas fa-bell-slash" aria-hidden="true"></i></div>
        <p>You're all caught up</p>
        <span>New messages and order updates appear here</span>
      </div>`,
  });

  if (started) {
    document.dispatchEvent(new CustomEvent("bfm-buyer-badges"));
    return;
  }
  started = true;

  subscribeInbox(supabase, buyerUser.uid, {
    onMessage: onGlobalMessage,
    onCallInvite: onGlobalCallInvite,
  });

  subscribeOrders();
  requestBrowserPermission();
}

export function stopBuyerNotifications() {
  unsubscribeInbox(supabase);
  if (ordersChannel) {
    supabase.removeChannel(ordersChannel);
    ordersChannel = null;
  }
  stopNotificationCenter();
  started = false;
}
