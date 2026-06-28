/* =============================================================
   BuyForMe — Shopper Dashboard JS
   ✅ Image sharing
   ✅ Voice notes
   ✅ Video calling (WebRTC)
   ✅ Voice calling (WebRTC, audio only)
   ✅ Payout details in settings
   ✅ Real payout history in earnings
   ============================================================= */

import { supabase } from "./supabase.js";
import { getShopperDashboardHref } from "./app-paths.js";
import { clearAuthSession } from "./auth-session.js";
import { clearCachedBuyerProfile } from "./buyer-session.js";
import { clearAppCache } from "./app-cache.js";
import { nameWithVerifiedBadge } from "./verified-badge.js";
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
  subscribeInbox,
  unsubscribeInbox,
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
  playMessageNotification,
  playIncomingCallRing,
  stopIncomingCallRing,
  playOutgoingRingback,
  stopOutgoingRingback,
  stopAllCallSounds,
} from "./app-sounds.js";
import { showIncomingCallScreen, hideIncomingCallScreen } from "./call-ui.js";
import {
  initNotificationCenter,
  pushNotification,
  renderNotificationList,
  clearNotificationCenter,
  updateNotificationDot,
} from "./notification-center.js";

/* ─── STATE ─── */
let currentUser    = null;
let currentProfile = null;
let allPayouts     = [];
const SHOPPER_STATUSES = ["paid", "purchased", "delivering", "delivered"];

/* Chat state */
let activeChatConvId  = null;
let activeChatPartner = null;
let allShopperConvs   = [];

/* Voice note state */
let shopperMediaRecorder = null;
let shopperAudioChunks   = [];
let shopperIsRecording   = false;

let shopperActiveCall = null;
let shopperIncomingCallKey = null;
let shopperThreadIds  = new Set();
let shopperRefreshTimer = null;

const SHOPPER_SIDEBAR_COLLAPSED_KEY = "buyforme-shopper-sidebar-collapsed";
const SHOPPER_DESKTOP_SIDEBAR_MQ = "(min-width: 769px)";
let shopperSidebarCollapseBound = false;

function scheduleShopperRefreshList() {
  clearTimeout(shopperRefreshTimer);
  shopperRefreshTimer = setTimeout(() => renderShopperChatList(), 120);
}

function getShopperChatUserId() {
  return String(currentProfile?.uid || currentUser?.id || "");
}

function wireShopperBrandLink() {
  const link = document.querySelector(".sidebar-brand .brand-link");
  if (!link) return;
  link.href = getShopperDashboardHref();
  link.setAttribute("aria-label", "Shopper dashboard");
  link.dataset.tooltip = "Dashboard";
}

/* ─── INIT ─── */
export async function bootstrapShopperDashboard() {
  document.body.addEventListener("click", () => unlockSounds(), { once: true });

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "auth.html"; return; }
  currentUser = session.user;

  const { data: profile, error: profileError } = await supabase
    .from("users").select("*").eq("uid", currentUser.id).maybeSingle();

  if (profileError) {
    console.error("Profile error:", profileError);
    showToast("Could not load your account. Please try again.", "error");
    return;
  }

  if (!profile || profile.role !== "shopper") {
    window.location.href = profile?.role === "buyer" ? "buyers.html" : "auth.html";
    return;
  }
  if (profile.verification_status?.toLowerCase() !== "approved") { window.location.href = "verify.html"; return; }

  currentProfile = profile;

  wireShopperBrandLink();
  renderSidebarProfile();
  await renderRequests();
  await renderOrders();
  await renderStats();
  await renderEarnings();
  loadSettingsIntoForm();
  initTabs();
  initShopperSidebarCollapse();
  initSettingsTabs();
  initDashPreferences();
  initNotificationsPanel();
  initAvatarUpload();
  initShopperVideoUpload();
  updateNotifDot();
  initRealtimeOrders();
  subscribeInbox(supabase, getShopperChatUserId(), {
    onMessage: handleShopperInboxMessage,
    onCallInvite: payload => handleShopperIncomingCall(payload),
  });
  await renderShopperChatList();

  document.getElementById("shopperChatInput")?.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendShopperMessage(); }
  });

  document.getElementById("msgConvSearch")?.addEventListener("input", function (e) {
    filterShopperConversations(e.target.value.trim());
  });
}

const reactRoot = document.getElementById("root");
if (!reactRoot?.dataset?.react) {
  document.addEventListener("DOMContentLoaded", bootstrapShopperDashboard);
}

/* ─── HELPERS ─── */
function faIcon(name, extraClass = "") {
  return `<i class="fas ${name}${extraClass ? ` ${extraClass}` : ""}" aria-hidden="true"></i>`;
}
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  setTimeout(() => { t.className = "toast"; }, 2800);
}

function formatTime(ts) {
  const d = new Date(ts), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function statusClass(s) { return "status-" + s.toLowerCase().replace(" ", "-"); }
function getStatusBadge(s) { return `<span class="status-badge ${statusClass(s)}">${s}</span>`; }

function escapeHtml(t) {
  return (t || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* ─── UI: skeletons, empty states, appearance, transitions ─── */
const TAB_REFRESH_MS = 12000;
const tabLastRefresh = {};
const PAYOUT_FIELD_SETS = {
  "Bank Transfer": ["account_name", "account_number", "bank_name", "country"],
  "Mobile Money": ["account_name", "account_number", "bank_name", "country"],
  "PayPal": ["email", "account_name"],
  "Wise / Revolut": ["email", "account_name", "account_number", "country"],
};
const PAYOUT_LABELS = {
  "Bank Transfer": {
    account_name: "Account Name",
    account_number: "Account Number / IBAN",
    bank_name: "Bank Name",
    country: "Country",
  },
  "Mobile Money": {
    account_name: "Full Name on Account",
    account_number: "Phone Number",
    bank_name: "Network / Provider",
    country: "Country",
  },
  "PayPal": {
    email: "PayPal Email Address",
    account_name: "Full Name on PayPal Account",
  },
  "Wise / Revolut": {
    email: "Wise / Revolut Email",
    account_name: "Full Name on Account",
    account_number: "Account Number / @Tag",
    country: "Country",
  },
};
const PAYOUT_PROFILE_KEYS = {
  account_name: "payout_account_name",
  account_number: "payout_account_number",
  bank_name: "payout_bank_name",
  country: "payout_country",
  email: "payout_email",
};

function payoutLabelId(field) {
  return "payoutLabel" + field.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join("");
}

function getPayoutInput(field) {
  return document.querySelector(`[data-payout-input="${field}"]`)?.value.trim() || "";
}

function setPayoutInputsFromProfile(profile) {
  document.querySelectorAll("[data-payout-input]").forEach(input => {
    const key = PAYOUT_PROFILE_KEYS[input.dataset.payoutInput];
    if (key) input.value = profile[key] || "";
  });
}

function retriggerAnimation(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

function activateDashSection(sectionId) {
  const target = document.getElementById(sectionId);
  if (!target) return;
  const current = document.querySelector(".dash-section.active");
  if (current === target) return;

  document.querySelectorAll(".dash-section").forEach(s => s.classList.remove("active", "dash-animate-in"));
  target.classList.add("active");
  retriggerAnimation(target, "dash-animate-in");

  const main = document.querySelector(".dashboard-main");
  if (main) main.scrollTo({ top: 0, behavior: "smooth" });
}

function shouldRefreshTab(tabId) {
  const now = Date.now();
  if (tabLastRefresh[tabId] && now - tabLastRefresh[tabId] < TAB_REFRESH_MS) return false;
  tabLastRefresh[tabId] = now;
  return true;
}

function invalidateTabRefresh(...tabIds) {
  tabIds.forEach(id => { delete tabLastRefresh[id]; });
}

function skeletonRequestList(count = 3) {
  const card = () => `
    <div class="request-item skeleton-card">
      <div class="skeleton-block">
        <span class="skeleton-line w-70"></span>
        <span class="skeleton-line w-55"></span>
        <span class="skeleton-line w-40"></span>
      </div>
      <span class="skeleton-action"></span>
    </div>`;
  return `<div class="skeleton-list">${Array.from({ length: count }, card).join("")}</div>`;
}

function skeletonConvList(count = 5) {
  const row = () => `
    <div class="skeleton-conv-item">
      <span class="skeleton-avatar"></span>
      <div class="skeleton-conv-lines">
        <span class="skeleton-line w-55"></span>
        <span class="skeleton-line w-85"></span>
      </div>
    </div>`;
  return `<div class="skeleton-conv-list">${Array.from({ length: count }, row).join("")}</div>`;
}

function skeletonPayoutHistory() {
  const rows = [1, 2, 3].map(() => `
    <div class="skeleton-table-row">
      <span></span><span></span><span></span><span></span><span></span><span></span>
    </div>`).join("");
  return `
    <div class="payout-history-block">
      <span class="skeleton-line w-40" style="height:18px;display:block;margin-bottom:14px"></span>
      <div class="skeleton-table-wrap">${rows}</div>
    </div>`;
}

function emptyState({ icon = "fa-inbox", title = "", message, ctaText, section, settingsTab }) {
  const sub = settingsTab ? `,'${settingsTab}'` : "";
  const btn = ctaText && section
    ? `<button type="button" class="btn btn-primary empty-state-cta" onclick="switchToDashTab('${section}'${sub})">${ctaText}</button>`
    : "";
  const titleHtml = title ? `<h3 class="empty-title">${title}</h3>` : "";
  const iconHtml = icon.startsWith("fa-") ? faIcon(icon) : faIcon("fa-inbox");
  return `
    <div class="empty-state">
      <div class="empty-icon">${iconHtml}</div>
      ${titleHtml}
      <p>${message}</p>
      ${btn}
    </div>`;
}

function initSettingsTabs() {
  document.querySelectorAll(".settings-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const id = tab.dataset.settingsTab;
      document.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".settings-panel").forEach(p => p.classList.remove("active", "settings-animate-in"));
      tab.classList.add("active");
      const panel = document.getElementById(`settings-panel-${id}`);
      if (panel) {
        panel.classList.add("active");
        retriggerAnimation(panel, "settings-animate-in");
      }
    });
  });
}

function syncPrefButtons(pref, value) {
  document.querySelectorAll(`.pref-toggle-group[data-pref="${pref}"] .pref-toggle-btn`).forEach(btn => {
    btn.classList.toggle("active", btn.dataset.value === value);
  });
}

function initDashPreferences() {
  const root = document.documentElement;
  const theme = localStorage.getItem("bfm-theme") || "light";
  const density = localStorage.getItem("bfm-density") || "comfortable";
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-density", density);
  syncPrefButtons("theme", theme);
  syncPrefButtons("density", density);

  document.querySelectorAll(".pref-toggle-group[data-pref]").forEach(group => {
    group.querySelectorAll(".pref-toggle-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const pref = group.dataset.pref;
        const value = btn.dataset.value;
        if (pref === "theme") {
          root.setAttribute("data-theme", value);
          localStorage.setItem("bfm-theme", value);
        } else if (pref === "density") {
          root.setAttribute("data-density", value);
          localStorage.setItem("bfm-density", value);
        }
        syncPrefButtons(pref, value);
      });
    });
  });
}

window.switchToDashTab = function (sectionId, settingsSubTab) {
  document.querySelector(`.sidebar-menu a[data-tab="${sectionId}"]`)?.click();
  if (settingsSubTab) {
    setTimeout(() => {
      document.querySelector(`.settings-tab[data-settings-tab="${settingsSubTab}"]`)?.click();
    }, 0);
  }
};

function renderSidebarProfile() {
  const name = currentProfile.name || "Shopper";
  const sidebarName = document.getElementById("sidebarName");
  if (sidebarName) {
    sidebarName.innerHTML = nameWithVerifiedBadge(name, {
      tag: "span",
      className: "sidebar-name-verified",
      size: 18,
    });
  }
  document.getElementById("welcomeMsg").textContent  = `Welcome back, ${name.split(" ")[0]}!`;
  const el = document.getElementById("sidebarAvatar");
  if (currentProfile.avatar_url) {
    el.innerHTML = `<img src="${currentProfile.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else { el.textContent = name[0].toUpperCase(); }
}

async function renderStats() {
  const orders    = await getOrders();
  const completed = orders.filter(o => o.status === "delivered").length;
  const earned    = orders.filter(o => o.status === "delivered").reduce((s,o) => s + (parseFloat(o.budget)||0)*0.85, 0);
  document.getElementById("statEarnings").textContent = `$${earned.toFixed(0)}`;
  document.getElementById("statOrders").textContent   = completed;
  document.getElementById("statRating").textContent   = currentProfile.rating || "—";
}

/* ─── SIDEBAR COLLAPSE ─── */
function isShopperDesktopSidebar() {
  return window.matchMedia(SHOPPER_DESKTOP_SIDEBAR_MQ).matches;
}

function isShopperSidebarCollapsedStored() {
  try {
    return localStorage.getItem(SHOPPER_SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function setShopperSidebarCollapsed(collapsed) {
  const btn = document.getElementById("shopperSidebarCollapse");
  const onDesktop = isShopperDesktopSidebar();

  document.body.classList.toggle("shopper-sidebar-collapsed", collapsed && onDesktop);

  if (btn) {
    const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.setAttribute("aria-label", label);
    btn.dataset.tooltip = label;
    const icon = btn.querySelector("i");
    if (icon) icon.className = collapsed ? "fas fa-angles-right" : "fas fa-angles-left";
  }

  if (onDesktop) {
    try {
      localStorage.setItem(SHOPPER_SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
}

function applyStoredShopperSidebarState() {
  if (isShopperDesktopSidebar() && isShopperSidebarCollapsedStored()) {
    setShopperSidebarCollapsed(true);
  }
}

function initShopperSidebarCollapse() {
  const btn = document.getElementById("shopperSidebarCollapse");
  if (!btn || shopperSidebarCollapseBound) return;

  applyStoredShopperSidebarState();

  btn.addEventListener("click", () => {
    if (!isShopperDesktopSidebar()) return;
    const collapsed = document.body.classList.contains("shopper-sidebar-collapsed");
    setShopperSidebarCollapsed(!collapsed);
  });

  window.addEventListener("resize", () => {
    if (isShopperDesktopSidebar()) {
      applyStoredShopperSidebarState();
    } else {
      document.body.classList.remove("shopper-sidebar-collapsed");
    }
  });

  shopperSidebarCollapseBound = true;
}

/* ─── TABS ─── */
function initTabs() {
  const tabs = document.querySelectorAll(".sidebar-menu a[data-tab]");
  tabs.forEach(tab => {
    tab.addEventListener("click", function (e) {
      e.preventDefault();
      const sectionId = this.dataset.tab;
      tabs.forEach(t => t.classList.remove("active"));
      this.classList.add("active");
      activateDashSection(sectionId);

      document.querySelector(".sidebar.is-open")?.classList.remove("is-open");
      document.body.classList.remove("sidebar-open");

      if (sectionId === "messages-section") {
        const b = document.getElementById("msgBadge");
        if (b) b.style.display = "none";
        if (shouldRefreshTab(sectionId)) renderShopperChatList();
      } else {
        document.querySelector(".messages-section-inner")?.classList.remove("thread-open");
      }
      if (sectionId === "requests-section" && shouldRefreshTab(sectionId)) renderRequests();
      if (sectionId === "orders-section" && shouldRefreshTab(sectionId)) renderOrders();
      if (sectionId === "earnings-section" && shouldRefreshTab(sectionId)) renderEarnings();
      if (sectionId === "overview-section" && shouldRefreshTab(sectionId)) {
        renderRequests();
        renderStats();
      }
    });
  });
}

/* ─── REQUESTS ─── */
async function renderRequests() {
  const list = document.getElementById("requestList");
  const ov   = document.getElementById("overviewRequestList");
  list.innerHTML = ov.innerHTML = skeletonRequestList(3);

  const { data: reqs, error } = await supabase
    .from("requests").select("*").eq("shopper_id", currentUser.id).eq("status","pending")
    .order("created_at",{ascending:false});

  if (error) {
    const err = emptyState({ icon: "fa-circle-exclamation", title: "Couldn't load requests", message: "Check your connection and try again.", ctaText: "Retry", section: "requests-section" });
    list.innerHTML = ov.innerHTML = err;
    return;
  }

  document.getElementById("requestCount").textContent     = `${reqs.length} new`;
  document.getElementById("overviewReqCount").textContent = `${reqs.length} new`;

  const badge = document.getElementById("reqBadge");
  if (reqs.length > 0) { badge.textContent = reqs.length; badge.style.display = "inline-block"; }
  else badge.style.display = "none";

  if (reqs.length === 0) {
    const e = emptyState({
      icon: "fa-inbox",
      title: "No new requests",
      message: "When buyers send shopping requests, they'll appear here. Keep your profile complete to get more matches.",
      ctaText: "Complete profile",
      section: "settings-section",
      settingsTab: "profile",
    });
    list.innerHTML = ov.innerHTML = e;
    return;
  }
  list.innerHTML = reqs.map(buildRequestCard).join("");
  ov.innerHTML   = reqs.slice(0,3).map(buildRequestCard).join("");
}

function buildRequestCard(r) {
  return `
    <div class="request-item">
      <div>
        <h4>${r.product_name}</h4>
        <div class="request-meta">
          <span><i class="fas fa-user"></i> ${r.buyer_name}</span>
          <span><i class="fas fa-tag"></i> ${r.category||"—"}</span>
          <span><i class="fas fa-clock"></i> ${new Date(r.created_at).toLocaleDateString()}</span>
        </div>
        ${r.notes ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-top:6px;line-height:1.5">${r.notes}</p>` : ""}
      </div>
      <div class="request-action">
        <div class="service-fee">${r.currency||"$"}${r.budget}</div>
        <div class="fee-label">Budget</div>
        <button class="btn btn-secondary" onclick="sendQuote('${r.id}',${JSON.stringify(r.product_name)},${r.budget},${JSON.stringify(r.currency || "USD")})">Send quote</button>
        <button class="btn btn-primary" onclick="acceptRequest('${r.id}','${r.product_name}')">Accept</button>
        <button class="btn btn-danger"  onclick="declineRequest('${r.id}','${r.product_name}')">Decline</button>
      </div>
    </div>`;
}

window.acceptRequest = async function (id, name) {
  const { error } = await supabase.from("requests").update({status:"accepted"}).eq("id",id);
  if (error) { showToast("Failed to accept.", "error"); return; }
  addNotification(`New order accepted: ${name}`);
  showToast(`Request accepted: ${name}`);
  invalidateTabRefresh("requests-section", "overview-section", "orders-section");
  await renderRequests(); await renderOrders(); await renderStats();
};

window.declineRequest = async function (id, name) {
  if (!confirm(`Decline request for "${name}"?`)) return;
  const { error } = await supabase.from("requests").update({status:"cancelled"}).eq("id",id);
  if (error) { showToast("Failed to decline.", "error"); return; }
  showToast(`Request declined: ${name}`, "error");
  invalidateTabRefresh("requests-section", "overview-section");
  await renderRequests();
};

window.sendQuote = async function (id, name, currentBudget, currency) {
  const amountStr = prompt(`Quote price for "${name}" (${currency}):`, String(currentBudget || ""));
  if (amountStr === null) return;
  const budget = parseFloat(amountStr);
  if (!Number.isFinite(budget) || budget <= 0) {
    showToast("Enter a valid amount.", "error");
    return;
  }
  const quoteNotes = prompt("Notes for the buyer (optional):") || "";

  const { data: order } = await supabase.from("requests").select("*").eq("id", id).maybeSingle();
  if (!order) { showToast("Order not found.", "error"); return; }

  const feeRatio = order.budget > 0 ? (order.shopper_fee || 0) / order.budget : 0.1;
  const platformRatio = order.budget > 0 ? (order.platform_fee || 0) / order.budget : 0.05;
  const shopperFee = Math.round(budget * feeRatio * 100) / 100;
  const platformFee = Math.round(budget * platformRatio * 100) / 100;
  const total = Math.round((budget + shopperFee + platformFee) * 100) / 100;

  const { error } = await supabase.from("requests").update({
    status: "quoted",
    budget,
    shopper_fee: shopperFee,
    platform_fee: platformFee,
    total_amount: total,
    quote_notes: quoteNotes,
    quoted_at: new Date().toISOString(),
    request_type: "quote",
  }).eq("id", id);

  if (error) { showToast("Failed to send quote.", "error"); return; }
  addNotification(`Quote sent for ${name}`, { type: "order" });
  showToast(`Quote sent: ${currency}${budget}`);
  invalidateTabRefresh("requests-section", "overview-section");
  await renderRequests();
};

/* ─── ORDERS ─── */
async function getOrders() {
  const { data, error } = await supabase.from("requests").select("*")
    .eq("shopper_id", currentUser.id).neq("status","pending").neq("status","cancelled").neq("status","quoted")
    .order("created_at",{ascending:false});
  if (error) return [];
  return data || [];
}

async function renderOrders() {
  const list = document.getElementById("orderList");
  list.innerHTML = skeletonRequestList(2);

  const orders = await getOrders();
  document.getElementById("orderCount").textContent = `${orders.length} order${orders.length !== 1 ? "s" : ""}`;

  if (orders.length === 0) {
    list.innerHTML = emptyState({
      icon: "fa-bag-shopping",
      title: "No orders yet",
      message: "Accept a request to start your first order. Buyers will pay before you shop.",
      ctaText: "View requests",
      section: "requests-section",
    });
    return;
  }

  list.innerHTML = orders.map(o => {
    const isLocked    = o.status==="accepted" || o.status==="payment";
    const isCompleted = o.status==="delivered";
    let action = "";
    if (isCompleted)    action = `<button class="btn btn-ghost" disabled>Completed <i class="fas fa-check"></i></button>`;
    else if (isLocked)  action = `<button class="btn btn-secondary" disabled><i class="fas fa-lock" style="margin-right:6px"></i>Waiting for Payment</button>`;
    else                action = `<button class="btn btn-primary" onclick="cycleOrderStatus('${o.id}','${o.status}')">Update Status</button>`;

    const shipLine = (o.status === "delivering" || o.status === "delivered") && (o.tracking_number || o.carrier)
      ? `<div class="request-meta" style="margin-top:8px">
           <span><i class="fas fa-truck"></i> ${o.carrier || "Carrier"} · ${o.tracking_number || "—"}</span>
           ${o.estimated_delivery ? `<span><i class="fas fa-calendar"></i> ETA ${new Date(o.estimated_delivery).toLocaleDateString()}</span>` : ""}
         </div>`
      : "";

    return `
      <div class="request-item">
        <div>
          <h4>${o.product_name}</h4>
          <div class="request-meta">
            <span><i class="fas fa-user"></i> ${o.buyer_name}</span>
            <span><i class="fas fa-map-marker-alt"></i> ${o.address||"—"}</span>
            <span><i class="fas fa-dollar-sign"></i> ${o.currency||"$"}${o.budget} budget</span>
          </div>
          <div style="margin-top:8px">${getStatusBadge(o.status)}</div>
          ${shipLine}
        </div>
        <div class="request-action">${action}</div>
      </div>`;
  }).join("");
}

window.cycleOrderStatus = async function (id, current) {
  const idx = SHOPPER_STATUSES.indexOf(current);
  if (idx === -1) { showToast("Cannot update this order.", "error"); return; }
  if (idx === SHOPPER_STATUSES.length-1) { showToast("Already completed.", "error"); return; }
  const next = SHOPPER_STATUSES[idx+1];

  let patch = { status: next };
  if (next === "delivering") {
    const carrier = prompt("Carrier name (e.g. DHL, FedEx):");
    if (carrier === null) return;
    const tracking = prompt("Tracking number:");
    if (tracking === null) return;
    const etaStr = prompt("Estimated delivery (YYYY-MM-DD) — optional:");
    patch = {
      status: next,
      carrier: carrier.trim() || null,
      tracking_number: tracking.trim() || null,
      shipped_at: new Date().toISOString(),
      estimated_delivery: etaStr ? new Date(etaStr).toISOString() : null,
    };
  }

  const { error } = await supabase.from("requests").update(patch).eq("id", id);
  if (error) { showToast("Failed to update.", "error"); return; }
  showToast(`Updated to: ${next}`);
  invalidateTabRefresh("orders-section", "earnings-section", "overview-section");
  await renderOrders(); await renderStats(); await renderEarnings();
};

/* ─── REALTIME ORDERS ─── */
function initRealtimeOrders() {
  supabase.channel("shopper-orders-"+currentUser.id)
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"requests",filter:`shopper_id=eq.${currentUser.id}`},
      async (payload) => {
        const u = payload.new;
        if (u.status==="paid") {
          showToast(`Payment: ${u.buyer_name} paid for "${u.product_name}"!`);
          addNotification(`Payment received from ${u.buyer_name} for "${u.product_name}"`);
        }
        if (u.status==="funded") {
          showToast(`Funds released for "${u.product_name}"! Check your payout details.`);
          addNotification(`Funds released for "${u.product_name}" — go purchase the item`);
        }
        await renderOrders(); await renderStats(); await renderEarnings();
      }).subscribe();
}

/* ══════════════════════════════════════════════
   EARNINGS — real payout history from payouts table
══════════════════════════════════════════════ */
async function renderEarnings() {
  const list = document.getElementById("earningsList");
  if (list) list.innerHTML = skeletonPayoutHistory();

  const orders    = await getOrders();
  const delivered = orders.filter(o => o.status === "delivered");
  const active    = orders.filter(o => !["delivered", "cancelled"].includes(o.status));

  const { data: payouts } = await supabase
    .from("payouts")
    .select("*")
    .eq("shopper_id", currentUser.id)
    .order("paid_at", { ascending: false });

  allPayouts = payouts || [];

  const totalPaidOut  = allPayouts.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const pendingEarned = active.reduce((s, o) => s + (parseFloat(o.budget) || 0) * 0.85, 0);

  const now = new Date();
  const thisMonthPayouts = allPayouts.filter(p => {
    const d = new Date(p.paid_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const thisMonth = thisMonthPayouts.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);

  document.getElementById("earnTotal").textContent      = `$${totalPaidOut.toFixed(2)}`;
  document.getElementById("earnMonth").textContent      = `$${thisMonth.toFixed(2)}`;
  document.getElementById("earnPending").textContent    = `$${pendingEarned.toFixed(2)}`;
  document.getElementById("earnCompleted").textContent = delivered.length;

  if (!list) return;

  if (allPayouts.length === 0) {
    list.innerHTML = `
      <div class="payout-history-block">
        <h2 class="section-title payout-history-title">Payout History</h2>
        ${emptyState({
          icon: "fa-credit-card",
          title: "No payouts yet",
          message: "Complete orders and add payout details to receive earnings.",
          ctaText: "Set up payout",
          section: "settings-section",
          settingsTab: "payout",
        })}
      </div>`;
    return;
  }

  const rows = allPayouts.map(p => `
    <tr>
      <td>${escapeHtml(p.product_name || "—")}</td>
      <td class="col-amount">$${parseFloat(p.amount || 0).toFixed(2)}</td>
      <td class="col-method">${methodIcon(p.method)} ${escapeHtml(p.method || "—")}</td>
      <td class="col-ref">${escapeHtml(p.reference || "—")}</td>
      <td class="col-date">${p.paid_at ? new Date(p.paid_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
      <td><span class="payout-status-received"><i class="fas fa-circle-check" aria-hidden="true"></i> Received</span></td>
    </tr>`).join("");

  list.innerHTML = `
    <div class="payout-history-block">
      <h2 class="section-title payout-history-title">Payout History</h2>
      <div class="payout-table-wrap">
        <table class="payout-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Amount</th>
              <th>Method</th>
              <th>Reference</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="payout-total-bar">
        <span><i class="fas fa-coins"></i> Total Received</span>
        <span>$${totalPaidOut.toFixed(2)}</span>
      </div>
    </div>`;
}

function methodIcon(method) {
  if (!method) return faIcon("fa-credit-card");
  const m = method.toLowerCase();
  if (m.includes("paypal")) return faIcon("fa-brands fa-paypal");
  if (m.includes("momo") || m.includes("mobile")) return faIcon("fa-mobile-screen-button");
  if (m.includes("wise") || m.includes("revolut")) return faIcon("fa-globe");
  if (m.includes("bank")) return faIcon("fa-building-columns");
  return faIcon("fa-credit-card");
}

/* ─── SETTINGS ─── */
function loadSettingsIntoForm() {
  document.getElementById("settingName").value           = currentProfile.name            || "";
  document.getElementById("settingEmail").value          = currentProfile.email           || "";
  document.getElementById("settingPhone").value          = currentProfile.phone           || "";
  document.getElementById("settingLocation").value       = currentProfile.location        || "";
  document.getElementById("settingAbout").value          = currentProfile.about           || "";
  document.getElementById("settingFee").value            = currentProfile.fee             || "";
  document.getElementById("settingYearsActive").value    = parseInt(currentProfile.years_active)||"";
  document.getElementById("settingResponseTime").value   = currentProfile.response_time   || "";
  document.getElementById("settingCompletionRate").value = currentProfile.completion_rate || "";
  document.getElementById("settingTags").value           = currentProfile.tags            || "";

  const methodEl = document.getElementById("payoutMethod");
  if (methodEl && currentProfile.payout_method) {
    methodEl.value = currentProfile.payout_method;
    togglePayoutFields(currentProfile.payout_method);
  }
  setPayoutInputsFromProfile(currentProfile);

  const toggle = document.getElementById("notifToggle");
  if (toggle) toggle.className = `toggle-track ${currentProfile.notifications?"on":""}`;
  if (currentProfile.avatar_url)
    document.getElementById("avatarPreview").innerHTML =
      `<img src="${currentProfile.avatar_url}" style="width:64px;height:64px;border-radius:50%;object-fit:cover">`;

  renderShopperVideosManager();
}

/* ─── PROFILE VIDEOS ─── */
const MAX_PROFILE_VIDEOS = 6;
const MAX_VIDEO_BYTES    = 300 * 1024 * 1024; // ~4–5 min phone video
const VIDEO_BUCKET       = "shopper-videos";
const VIDEO_UPLOAD_MS    = 15 * 60 * 1000;  // 15 min for large uploads on slow Wi‑Fi
const VIDEO_EXTENSIONS   = new Set(["mp4", "webm", "mov", "m4v", "avi", "mkv", "3gp"]);

function mimeFromExt(ext) {
  const map = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    "3gp": "video/3gpp",
  };
  return map[ext] || "video/mp4";
}

function isVideoFile(file, ext) {
  if (file.type && file.type.startsWith("video/")) return true;
  return VIDEO_EXTENSIONS.has(ext);
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(v => { clearTimeout(timer); resolve(v); })
      .catch(e => { clearTimeout(timer); reject(e); });
  });
}

function parseProfileVideos(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function renderShopperVideosManager() {
  const list = document.getElementById("shopperVideosList");
  const btn  = document.getElementById("btnUploadVideo");
  if (!list) return;

  const videos = parseProfileVideos(currentProfile.profile_videos);

  if (videos.length === 0) {
    list.innerHTML = `<p class="shopper-videos-empty">No videos yet. <button type="button" class="btn btn-ghost" style="margin-top:10px" onclick="document.getElementById(\'shopperVideoInput\').click()">Upload your first clip</button></p>`;
  } else {
    list.innerHTML = videos.map(v => `
      <div class="shopper-video-item" data-id="${v.id}">
        <video src="${v.url}" muted playsinline preload="metadata"></video>
        <div class="shopper-video-meta">
          <span class="shopper-video-title">${escapeHtml(v.title || "Video")}</span>
          <button type="button" class="shopper-video-delete" onclick="deleteShopperVideo('${v.id}')" title="Remove">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>`).join("");
  }

  if (btn) btn.disabled = videos.length >= MAX_PROFILE_VIDEOS;
}

function setVideoUploadStatus(text, isError = false) {
  const el = document.getElementById("shopperVideoUploadStatus");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "var(--red)" : "var(--text-muted)";
}

async function persistProfileVideos(videos) {
  const { error } = await supabase
    .from("users")
    .update({ profile_videos: videos })
    .eq("uid", currentUser.id);
  if (error) throw error;
  currentProfile.profile_videos = videos;
}

function resetVideoUploadUi() {
  const btn = document.getElementById("btnUploadVideo");
  const videos = parseProfileVideos(currentProfile.profile_videos);
  if (btn) btn.disabled = videos.length >= MAX_PROFILE_VIDEOS;
}

function initShopperVideoUpload() {
  const input = document.getElementById("shopperVideoInput");
  if (!input) return;

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const videos = parseProfileVideos(currentProfile.profile_videos);
    if (videos.length >= MAX_PROFILE_VIDEOS) {
      showToast(`Maximum ${MAX_PROFILE_VIDEOS} videos allowed.`, "error");
      return;
    }

    const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
    if (!isVideoFile(file, ext)) {
      showToast("Please choose a video file (MP4, MOV, WebM, etc.).", "error");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      showToast("Video must be under 300 MB (about 4–5 minutes).", "error");
      return;
    }

    const defaultTitle = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "My video";
    const title = window.prompt("Video title (shown to buyers):", defaultTitle);
    if (title === null) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showToast("Session expired. Please log in again.", "error");
      return;
    }

    const id           = crypto.randomUUID();
    const path         = `${session.user.id}/${id}.${ext}`;
    const contentType  = (file.type && file.type.startsWith("video/")) ? file.type : mimeFromExt(ext);
    const uploadBtn    = document.getElementById("btnUploadVideo");

    setVideoUploadStatus("Uploading… 4–5 min videos may take several minutes.");
    if (uploadBtn) uploadBtn.disabled = true;

    let uploadedPath = null;

    try {
      const { error: upErr } = await withTimeout(
        supabase.storage.from(VIDEO_BUCKET).upload(path, file, {
          upsert: true,
          contentType,
          cacheControl: "3600",
        }),
        VIDEO_UPLOAD_MS,
        "Upload timed out. Try MP4, a stronger Wi‑Fi connection, or a slightly shorter clip."
      );

      if (upErr) {
        const hint = upErr.message?.includes("mime")
          ? " In Supabase: Storage → shopper-videos → allow all video types, or use MP4."
          : "";
        throw new Error((upErr.message || "Storage upload failed.") + hint);
      }

      uploadedPath = path;
      setVideoUploadStatus("Saving to your profile…");

      const { data: urlData } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(path);
      const entry = {
        id,
        url: urlData.publicUrl,
        path,
        title: (title || defaultTitle).trim().slice(0, 80),
        created_at: new Date().toISOString(),
      };

      await persistProfileVideos([...videos, entry]);
      renderShopperVideosManager();
      setVideoUploadStatus("");
      showToast("Video uploaded! Buyers can see it on your profile.");
    } catch (e) {
      console.error("Profile video upload:", e);
      if (uploadedPath) {
        await supabase.storage.from(VIDEO_BUCKET).remove([uploadedPath]);
      }
      const msg = e?.message || "Upload failed.";
      setVideoUploadStatus(msg, true);
      showToast(msg, "error");
    } finally {
      resetVideoUploadUi();
    }
  });
}

window.deleteShopperVideo = async function (videoId) {
  if (!confirm("Remove this video from your profile?")) return;

  const videos = parseProfileVideos(currentProfile.profile_videos);
  const target = videos.find(v => v.id === videoId);
  if (!target) return;

  if (target.path) {
    await supabase.storage.from(VIDEO_BUCKET).remove([target.path]);
  }

  try {
    await persistProfileVideos(videos.filter(v => v.id !== videoId));
    renderShopperVideosManager();
    showToast("Video removed.");
  } catch (e) {
    showToast("Could not remove video: " + e.message, "error");
  }
};

window.togglePayoutFields = function (method) {
  const wrap = document.getElementById("payoutFieldsWrap");
  if (!wrap) return;

  if (!method) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;
  const visible = PAYOUT_FIELD_SETS[method] || [];
  const labels = PAYOUT_LABELS[method] || {};

  document.querySelectorAll(".payout-field").forEach(el => {
    const field = el.dataset.payoutField;
    el.hidden = !visible.includes(field);
    const labelEl = document.getElementById(payoutLabelId(field));
    if (labelEl && labels[field]) labelEl.textContent = labels[field];
  });

  retriggerAnimation(wrap, "payout-fields-animate-in");
};

window.toggleNotif = function () {
  document.getElementById("notifToggle")?.classList.toggle("on");
};

window.saveSettings = async function () {
  const fields = {
    name:"settingName", email:"settingEmail", phone:"settingPhone",
    location:"settingLocation", about:"settingAbout", fee:"settingFee",
    response_time:"settingResponseTime", completion_rate:"settingCompletionRate", tags:"settingTags"
  };
  const update = {};
  for (const [key, id] of Object.entries(fields)) update[key] = document.getElementById(id)?.value.trim() || "";
  update.years_active  = parseInt(document.getElementById("settingYearsActive")?.value)||0;
  update.notifications = document.getElementById("notifToggle")?.classList.contains("on") || false;

  const { error } = await supabase.from("users").update(update).eq("uid", currentUser.id);
  if (error) { showToast("Failed to save.", "error"); return; }
  Object.assign(currentProfile, update);
  renderSidebarProfile();
  showToast("Profile saved!");
};

window.savePayoutDetails = async function () {
  const method = document.getElementById("payoutMethod")?.value || "";
  if (!method) { showToast("Please select a payout method.", "error"); return; }

  const update = { payout_method: method };
  for (const [field, profileKey] of Object.entries(PAYOUT_PROFILE_KEYS)) {
    update[profileKey] = getPayoutInput(field);
  }

  const { error } = await supabase.from("users").update(update).eq("uid", currentUser.id);
  if (error) { showToast("Failed to save payout details.", "error"); return; }

  Object.assign(currentProfile, update);
  showToast("Payout details saved! Admin will use these to send your money.", "success");
};

function initAvatarUpload() {
  document.getElementById("settingAvatar")?.addEventListener("change", async function () {
    const file = this.files[0]; if (!file) return;
    const path = `${currentUser.id}/avatar.${file.name.split(".").pop()}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, {upsert:true});
    if (error) { showToast(`Upload failed: ${error.message}`, "error"); return; }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    await supabase.from("users").update({avatar_url:data.publicUrl}).eq("uid",currentUser.id);
    currentProfile.avatar_url = data.publicUrl;
    document.getElementById("avatarPreview").innerHTML =
      `<img src="${data.publicUrl}" style="width:64px;height:64px;border-radius:50%;object-fit:cover">`;
    renderSidebarProfile();
    showToast("Avatar updated!");
  });
}

async function handleShopperInboxMessage(msg) {
  const myId = getShopperChatUserId();
  const partnerUid = getPartnerUidFromMessage(msg, myId);
  const canonicalId = getConvId(myId, partnerUid);

  const fromOther = String(msg.sender_id) !== myId;
  const inOpenThread =
    activeChatPartner &&
    String(activeChatPartner.uid) === partnerUid &&
    document.getElementById("msgThreadMessages")?.style.display !== "none";

  if (fromOther && !inOpenThread) {
    playMessageNotification();
    showToast(`New message from ${msg.sender_name || "Buyer"}`);
    addNotification(`Message from ${msg.sender_name}: "${getPreviewText(msg.content || "")}"`);
  }

  if (
    activeChatPartner &&
    (String(activeChatPartner.uid) === partnerUid || activeChatConvId === canonicalId)
  ) {
    activeChatConvId = canonicalId;
    appendShopperMessageToThread(msg);
    if (String(msg.receiver_id) === myId && !msg.is_read) {
      await markConversationRead(canonicalId, myId, partnerUid);
    }
  }

  scheduleShopperRefreshList();
}

/* ─── CHAT (Supabase) ─── */
async function renderShopperChatList() {
  const list = document.getElementById("msgConvList");
  if (!list) return;
  list.innerHTML = skeletonConvList(5);

  allShopperConvs = await getConversationSummaries(getShopperChatUserId());

  if (allShopperConvs.length === 0) {
    list.innerHTML = emptyState({
      icon: "fa-comments",
      title: "No messages yet",
      message: "Buyers reach out from your public profile. Add videos so buyers trust you faster.",
      ctaText: "Add profile videos",
      section: "settings-section",
      settingsTab: "videos",
    });
    updateMsgBadge(0);
    return;
  }

  const unreadMap = await getUnreadMap(getShopperChatUserId());
  const total = Object.values(unreadMap).reduce((a, b) => a + b, 0);
  updateMsgBadge(total);
  renderShopperConvItems(allShopperConvs, unreadMap);
}

function renderShopperConvItems(convs, unreadMap = {}) {
  const list = document.getElementById("msgConvList");
  if (!list) return;
  if (convs.length === 0) {
    list.innerHTML = emptyState({
      icon: "fa-magnifying-glass",
      title: "No matches",
      message: "Try a different name or clear your search.",
    });
    return;
  }
  list.innerHTML = convs.map(m => {
    const isMine    = String(m.sender_id) === getShopperChatUserId();
    const partner   = m._partner;
    const otherName = partner?.name || (isMine ? m.receiver_name : m.sender_name);
    const otherId   = partner?.uid  || (isMine ? m.receiver_id   : m.sender_id);
    const preview   = getPreviewText(m.content || "");
    const time      = formatTime(m.created_at);
    const canonicalId = getConvId(getShopperChatUserId(), otherId);
    const unread    = unreadMap[canonicalId] || unreadMap[m.conversation_id] || 0;
    const isActive  = activeChatConvId === canonicalId;
    return `
      <div class="msg-conv-item ${isActive?"active":""}" onclick="openShopperChat('${otherId}','${escapeHtml(otherName)}')">
        <div class="msg-conv-avatar">${(otherName||"?")[0].toUpperCase()}</div>
        <div class="msg-conv-info">
          <div class="msg-conv-name-row">
            <span class="msg-conv-name">${otherName}</span>
            <span class="msg-conv-time">${time}</span>
          </div>
          <div class="msg-conv-bottom">
            <span class="msg-conv-preview">${isMine?"You: ":""}${escapeHtml(preview)}</span>
            ${unread > 0 ? `<span class="msg-unread-badge">${unread}</span>` : ""}
          </div>
        </div>
      </div>`;
  }).join("");
}

function updateMsgBadge(count) {
  const b = document.getElementById("msgBadge");
  if (!b) return;
  b.textContent   = count;
  b.style.display = count > 0 ? "inline-block" : "none";
}

window.openShopperChat = async function (otherUid, otherName) {
  const myId = getShopperChatUserId();
  activeChatConvId  = getConvId(myId, otherUid);
  activeChatPartner = { uid: otherUid, name: otherName, role: "buyer" };
  setConversationPartner(activeChatConvId, activeChatPartner, myId);
  document.getElementById("msgThreadEmpty").style.display    = "none";
  document.getElementById("msgThreadHeader").style.display   = "flex";
  document.getElementById("msgThreadMessages").style.display = "flex";
  document.getElementById("msgThreadInput").style.display    = "flex";
  document.getElementById("msgThreadHav").textContent   = (otherName||"?")[0].toUpperCase();
  document.getElementById("msgThreadHname").textContent = otherName;
  document.querySelector(".messages-section-inner")?.classList.add("thread-open");
  shopperThreadIds = new Set();
  await loadShopperMessages();
  await markShopperRead();
  await renderShopperChatList();
};

window.backToShopperConvList = function () {
  document.querySelector(".messages-section-inner")?.classList.remove("thread-open");
  document.getElementById("msgThreadEmpty").style.display    = "flex";
  document.getElementById("msgThreadHeader").style.display   = "none";
  document.getElementById("msgThreadMessages").style.display = "none";
  document.getElementById("msgThreadInput").style.display    = "none";
  activeChatPartner = null;
  activeChatConvId = null;
  renderShopperChatList();
};

async function loadShopperMessages() {
  if (!activeChatPartner?.uid) return;
  const msgs = await getMessagesForPartner(getShopperChatUserId(), activeChatPartner.uid);
  const container = document.getElementById("msgThreadMessages");
  if (!container) return;
  shopperThreadIds = new Set((msgs || []).map(m => m.id).filter(Boolean));
  if (msgs.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:0.82rem;margin:auto;padding:30px">No messages yet</div>`;
    return;
  }
  let lastDate = null;
  container.innerHTML = msgs.map(m => {
    if (m.content === "[videocall]incoming" || m.content === "[voicecall]incoming") return "";
    const isMine  = String(m.sender_id) === getShopperChatUserId();
    const time    = new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
    const read    = isMine ? (m.is_read?" ✓✓":" ✓") : "";
    const msgDate = new Date(m.created_at).toLocaleDateString();
    let divider   = "";
    if (msgDate !== lastDate) { lastDate = msgDate; divider = `<div class="msg-date-divider">${msgDate}</div>`; }
    return `${divider}
      <div class="message ${isMine?"shopper-message":"buyer-message"}">
        <div>${renderShopperMsgContent(m.content)}</div>
        <div class="msg-time">${time}${read}</div>
      </div>`;
  }).join("");
  container.scrollTop = container.scrollHeight;
}

function appendShopperMessageToThread(m) {
  if (!m?.id || shopperThreadIds.has(m.id)) return;
  if (m.content === "[videocall]incoming" || m.content === "[voicecall]incoming") return;

  const container = document.getElementById("msgThreadMessages");
  if (!container || container.style.display === "none") return;

  shopperThreadIds.add(m.id);
  const empty = container.querySelector("div[style*='padding:30px']");
  if (empty) empty.remove();

  const myId   = getShopperChatUserId();
  const isMine = String(m.sender_id) === myId;
  const time   = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const read   = isMine ? (m.is_read ? " ✓✓" : " ✓") : "";
  const el     = document.createElement("div");
  el.className = `message ${isMine ? "shopper-message" : "buyer-message"}`;
  el.dataset.msgId = m.id;
  el.innerHTML = `<div>${renderShopperMsgContent(m.content)}</div><div class="msg-time">${time}${read}</div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function renderShopperMsgContent(content) {
  if (!content) return "";
  if (content.startsWith("[img]")) {
    const url = content.slice(5);
    return `<img src="${url}" style="max-width:200px;max-height:200px;border-radius:10px;cursor:pointer;display:block" onclick="window.open('${url}','_blank')" loading="lazy">`;
  }
  if (content.startsWith("[audio]")) {
    const url = content.slice(7);
    return `<audio controls style="max-width:190px;height:36px"><source src="${url}"></audio>`;
  }
  return escapeHtml(content);
}

function appendShopperOptimistic(content) {
  const container = document.getElementById("msgThreadMessages");
  if (!container) return;
  const empty = container.querySelector("div[style*='padding:30px']");
  if (empty) empty.remove();
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const el   = document.createElement("div");
  el.className = "message shopper-message";
  el.innerHTML = `<div>${renderShopperMsgContent(content)}</div><div class="msg-time">${time} ✓</div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

window.sendShopperMessage = async function () {
  const input   = document.getElementById("shopperChatInput");
  const content = input?.value.trim();
  if (!content || !activeChatConvId || !activeChatPartner) return;
  input.value = "";
  const msg = buildMessage({
    conversation_id: activeChatConvId,
    sender_id:       getShopperChatUserId(),
    sender_name:     currentProfile.name,
    sender_role:     "shopper",
    receiver_id:     activeChatPartner.uid,
    receiver_name:   activeChatPartner.name,
    content,
  });
  try {
    const saved = await sendChatMessage(supabase, msg);
    appendShopperMessageToThread(saved);
    scheduleShopperRefreshList();
  } catch (e) {
    console.error("Send error:", e);
    showToast("Failed to send.", "error");
  }
};

window.triggerShopperImageUpload = function () { document.getElementById("shopperImageInput")?.click(); };

window.handleShopperImageUpload = async function (e) {
  const file = e.target.files?.[0];
  if (!file || !activeChatConvId || !activeChatPartner) return;
  e.target.value = "";
  try {
    const blob = await compressImageToBlob(file);
    appendShopperOptimistic("[img]" + URL.createObjectURL(blob));
    const url = await uploadChatBlob(blob, {
      userId: getShopperChatUserId(),
      convId: activeChatConvId,
      ext: "jpg",
    });
    const msg = buildMessage({
      conversation_id: activeChatConvId,
      sender_id: getShopperChatUserId(),
      sender_name: currentProfile.name,
      sender_role: "shopper",
      receiver_id: activeChatPartner.uid,
      receiver_name: activeChatPartner.name,
      content: "[img]" + url,
    });
    await sendChatMessage(supabase, msg);
    await loadShopperMessages();
    scheduleShopperRefreshList();
  } catch (err) {
    showToast(err.message || "Failed to send image.", "error");
  }
};

window.toggleShopperVoice = async function () {
  if (shopperIsRecording) {
    shopperMediaRecorder?.stop();
    shopperIsRecording = false;
    const btn = document.getElementById("shopperVoiceBtn");
    if (btn) { btn.style.background = ""; btn.style.color = ""; btn.title = "Record voice note"; }
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      shopperAudioChunks   = [];
      shopperMediaRecorder = new MediaRecorder(stream);
      shopperMediaRecorder.ondataavailable = e => shopperAudioChunks.push(e.data);
      shopperMediaRecorder.onstop = async () => {
        const blob = new Blob(shopperAudioChunks, { type: "audio/webm" });
        stream.getTracks().forEach(t => t.stop());
        await uploadShopperAudio(blob);
      };
      shopperMediaRecorder.start();
      shopperIsRecording = true;
      const btn = document.getElementById("shopperVoiceBtn");
      if (btn) { btn.style.background = "#e74c3c"; btn.style.color = "#fff"; btn.title = "Click to stop recording"; }
    } catch { alert("Microphone access denied."); }
  }
};

async function uploadShopperAudio(blob) {
  if (!activeChatConvId || !activeChatPartner) return;
  appendShopperOptimistic("[audio]…");
  try {
    const url = await uploadChatBlob(blob, {
      userId: getShopperChatUserId(),
      convId: activeChatConvId,
      ext: "webm",
    });
    const msg = buildMessage({
      conversation_id: activeChatConvId,
      sender_id: getShopperChatUserId(),
      sender_name: currentProfile.name,
      sender_role: "shopper",
      receiver_id: activeChatPartner.uid,
      receiver_name: activeChatPartner.name,
      content: "[audio]" + url,
    });
    await sendChatMessage(supabase, msg);
    await loadShopperMessages();
    scheduleShopperRefreshList();
  } catch (e) {
    showToast(e.message || "Failed to send voice note.", "error");
  }
}

/* ─── CALLS ─── */
window.startShopperVideoCall = async function () {
  if (!activeChatPartner) return;
  await startShopperCall("video");
};
window.startShopperVoiceCall = async function () {
  if (!activeChatPartner) return;
  await startShopperCall("voice");
};
window.acceptShopperVideoCall = async function () {
  hideIncomingCallScreen();
  await acceptShopperCall("video");
};
window.acceptShopperVoiceCall = async function () {
  hideIncomingCallScreen();
  await acceptShopperCall("voice");
};
window.rejectShopperCall = async function () {
  hideIncomingCallScreen();
  stopAllCallSounds();
  if (shopperActiveCall) {
    try { await shopperActiveCall.rejectRemote?.(); } catch {}
    shopperActiveCall.end();
    shopperActiveCall = null;
  } else {
    await rejectIncomingCall();
  }
};
window.endShopperCall = function (playEndTone = true) {
  stopAllCallSounds();
  shopperActiveCall?.end(playEndTone);
  shopperActiveCall = null;
  shopperIncomingCallKey = null;
  clearIncomingCallPrep();
  hideIncomingCallScreen();
};

async function startShopperCall(callType) {
  window.endShopperCall(false);
  playOutgoingRingback();
  try {
    await sendCallInvite(supabase, {
      sender_id: getShopperChatUserId(),
      sender_name: currentProfile.name,
      sender_role: "shopper",
      receiver_id: activeChatPartner.uid,
      receiver_name: activeChatPartner.name,
      callType,
      conversation_id: activeChatConvId,
    });
    shopperActiveCall = await startOutgoingCall({
      supabase,
      myUserId: getShopperChatUserId(),
      partnerUserId: activeChatPartner.uid,
      partnerName: activeChatPartner.name,
      callType,
    });
  } catch (e) {
    showToast(e.message || "Could not start call.", "error");
    window.endShopperCall();
  }
}

async function acceptShopperCall(callType) {
  stopIncomingCallRing();
  stopOutgoingRingback();
  if (shopperActiveCall) {
    shopperActiveCall.end(false);
    shopperActiveCall = null;
  }
  try {
    shopperActiveCall = await acceptIncomingCall({
      supabase,
      myUserId: getShopperChatUserId(),
      partnerUserId: activeChatPartner.uid,
      partnerName: activeChatPartner.name,
      callType,
    });
  } catch (e) {
    showToast(e.message || "Could not connect call.", "error");
    window.endShopperCall();
  }
}


async function handleShopperIncomingCall(payload) {
  const myId = getShopperChatUserId();
  if (payload.receiver_id && String(payload.receiver_id) !== myId) return;

  const callType = payload.callType === "voice" ? "voice" : "video";
  const isVideo = callType === "video";
  const senderId = String(payload.sender_id);
  const key = `${senderId}:${callType}`;

  if (shopperIncomingCallKey === key) return;
  if (document.getElementById("bfmCallOverlay") || document.getElementById("bfmIncomingCall")) return;

  shopperIncomingCallKey = key;

  if (!activeChatPartner || String(activeChatPartner.uid) !== senderId) {
    activeChatPartner = { uid: senderId, name: payload.sender_name || "User", role: "buyer" };
    activeChatConvId = getConvId(myId, senderId);
    setConversationPartner(activeChatConvId, activeChatPartner, myId);
  }

  playIncomingCallRing();

  showIncomingCallScreen({
    partnerName: payload.sender_name || "Buyer",
    callType,
    onAccept: () => (isVideo ? acceptShopperVideoCall() : acceptShopperVoiceCall()),
    onDecline: () => rejectShopperCall(),
  });

  prepareIncomingCallSignaling(supabase, myId, senderId, callType).catch(e => {
    console.warn("Call pre-connect:", e?.message || e);
  });
}

async function markShopperRead() {
  if (!activeChatConvId || !activeChatPartner?.uid) return;
  await markConversationRead(activeChatConvId, getShopperChatUserId(), activeChatPartner.uid);
}

window.filterShopperConversations = function (query) {
  if (!query) { renderShopperConvItems(allShopperConvs); return; }
  const q = query.toLowerCase();
  const filtered = allShopperConvs.filter(m => {
    const isMine = String(m.sender_id) === getShopperChatUserId();
    const partner = m._partner;
    const otherName = partner?.name || (isMine ? m.receiver_name : m.sender_name);
    return (otherName || "").toLowerCase().includes(q) || (m.content || "").toLowerCase().includes(q);
  });
  renderShopperConvItems(filtered);
};

/* ─── NOTIFICATIONS (server-backed via notification-center) ─── */
async function initShopperNotifications() {
  const uid = currentUser?.id || currentProfile?.uid;
  if (!uid) return;

  await initNotificationCenter({
    userId: uid,
    legacyStorageKey: "bfm_notifications",
    listId: "notifDrawerList",
    dotSelectors: ["#notifDot"],
  });
}

function addNotification(msg, meta = {}) {
  pushNotification(msg, { type: meta.type || "info", title: meta.title, link: meta.link });
  updateNotifDot();
  if (document.getElementById("notifDrawer")?.classList.contains("is-open")) {
    renderNotificationsList();
  }
}

function updateNotifDot() {
  updateNotificationDot();
}

function renderNotificationsList() {
  renderNotificationList("notifDrawerList");
}

function initNotificationsPanel() {
  initShopperNotifications().catch(console.error);

  document.getElementById("notifDrawerBackdrop")?.addEventListener("click", closeNotifications);
  document.getElementById("notifDrawerClose")?.addEventListener("click", closeNotifications);
  document.getElementById("notifClearBtn")?.addEventListener("click", async () => {
    await clearNotificationCenter();
    showToast("Notifications cleared.");
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeNotifications();
  });
}

window.openNotifications = function () {
  renderNotificationsList();
  const drawer = document.getElementById("notifDrawer");
  if (!drawer) return;
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("notif-drawer-open");
};

window.closeNotifications = function () {
  const drawer = document.getElementById("notifDrawer");
  if (!drawer) return;
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("notif-drawer-open");
};

/* ─── LOGOUT ─── */
window.handleLogout = async function () {
  if (!confirm("Are you sure you want to log out?")) return;

  try {
    unsubscribeInbox(supabase);
  } catch (e) {
    console.warn("unsubscribeInbox:", e);
  }

  clearCachedBuyerProfile();
  clearAppCache();
  await clearAuthSession(supabase);
  window.location.replace("auth.html?logged_out=1");
};