/* Buyer app shell — sidebar, bottom nav, auth, badges */

import { supabase } from "./supabase.js";
import { getBuyerDashboardHref, getShopperDashboardHref } from "./app-paths.js";
import { clearAuthSession } from "./auth-session.js";
import { initBuyerNotifications, refreshBuyerBadges, stopBuyerNotifications } from "./buyer-notifications.js";

const NAV_ITEMS = [
  { key: "discover", href: "buyers.html", icon: "fa-compass", label: "Discover" },
  { key: "orders", href: "my-orders.html", icon: "fa-bag-shopping", label: "Orders", badge: "ordersBadge" },
  { key: "messages", href: "chat.html", icon: "fa-message", label: "Messages", badge: "messagesBadge" },
  { key: "account", href: "buyers.html?settings=1", icon: "fa-user", label: "Account" },
];

const SIDEBAR_COLLAPSED_KEY = "buyforme-buyer-sidebar-collapsed";
const DESKTOP_SIDEBAR_MQ = "(min-width: 901px)";

let shellUser = null;
let sidebarCollapseBound = false;

/** Clear Supabase auth storage and end the buyer session. */
export async function performBuyerLogout() {
  if (!confirm("Are you sure you want to log out?")) return;

  try {
    stopBuyerNotifications();
  } catch (e) {
    console.warn("stopBuyerNotifications:", e);
  }

  shellUser = null;
  delete document.body.dataset.shellInit;

  await clearAuthSession(supabase);
  window.location.replace("auth.html?logged_out=1");
}

export function showBuyerToast(message, duration = 4000) {
  const text = String(message || "").trim();
  if (!text) return;

  let el = document.getElementById("buyerToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "buyerToast";
    el.className = "buyer-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  }

  el.textContent = text;
  el.setAttribute("aria-hidden", "false");
  el.classList.add("show");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.classList.remove("show");
    el.setAttribute("aria-hidden", "true");
    el.textContent = "";
  }, duration);
}

async function ensureBuyerAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.assign("auth.html");
    return false;
  }

  const { data: profile, error } = await supabase
    .from("users")
    .select("*")
    .eq("uid", session.user.id)
    .maybeSingle();

  if (error || !profile) {
    window.location.assign("auth.html");
    return false;
  }

  const role = String(profile.role || "").toLowerCase();
  if (role === "shopper") {
    window.location.assign(
      profile.verification_status?.toLowerCase() === "approved"
        ? getShopperDashboardHref()
        : "verify.html"
    );
    return false;
  }

  shellUser = profile;
  return true;
}

function buildNavLinks(activeKey) {
  return NAV_ITEMS.map((item) => {
    const active = item.key === activeKey ? "active" : "";
    const badge = item.badge
      ? `<span class="nav-badge" id="shell-${item.badge}"></span>`
      : "";
    return `<li><a href="${item.href}" class="${active}" data-nav="${item.key}"
      aria-label="${escapeHtml(item.label)}" data-tooltip="${escapeHtml(item.label)}">
      <i class="fas ${item.icon}" aria-hidden="true"></i>
      <span class="nav-label">${item.label}</span>${badge}
    </a></li>`;
  }).join("");
}

function injectShell(activeKey, title) {
  if (document.getElementById("buyer-app-grid")) return;

  const initial = (shellUser?.name || "B")[0].toUpperCase();
  const firstName = (shellUser?.name || "Buyer").split(" ")[0];

  const grid = document.createElement("div");
  grid.id = "buyer-app-grid";
  grid.className = "buyer-app-grid";

  grid.innerHTML = `
    <div class="buyer-app-bg" aria-hidden="true"></div>
    <div class="buyer-sidebar-overlay" id="buyerSidebarOverlay"></div>
    <aside class="buyer-sidebar" id="buyerSidebar" aria-label="Buyer navigation">
      <div class="buyer-sidebar__brand">
        <a href="${getBuyerDashboardHref()}" class="brand-link" data-tooltip="Discover" aria-label="Buyer dashboard"><img src="images/logo.png" alt="BuyForMe" class="brand-logo brand-logo--sm"></a>
        <div class="buyer-sidebar__brand-actions">
        <button type="button" class="buyer-notif-bell" id="buyerNotifBell" aria-label="Notifications">
          <i class="fas fa-bell" aria-hidden="true"></i>
          <span class="buyer-notif-dot" id="buyerNotifDot"></span>
        </button>
        <button type="button" class="buyer-sidebar__collapse" id="buyerSidebarCollapse"
          aria-label="Collapse sidebar" aria-expanded="true" data-tooltip="Collapse sidebar">
          <i class="fas fa-angles-left" aria-hidden="true"></i>
        </button>
        </div>
      </div>
      <div class="buyer-sidebar__user">
        <div class="buyer-sidebar__avatar" id="shellAvatar">${initial}</div>
        <p class="buyer-sidebar__name">${escapeHtml(firstName)}</p>
        <p class="buyer-sidebar__role">Buyer account</p>
      </div>
      <ul class="buyer-nav">${buildNavLinks(activeKey)}</ul>
      <div class="buyer-sidebar__foot">
        <button type="button" class="buyer-sidebar__logout" id="shellLogout" aria-label="Log out" data-tooltip="Log out">
          <i class="fas fa-right-from-bracket" aria-hidden="true"></i>
          <span class="logout-label">Log out</span>
        </button>
      </div>
    </aside>
    <div class="buyer-main">
      <div class="buyer-mobile-bar">
        <button type="button" class="buyer-menu-btn" id="buyerMenuBtn" aria-label="Open menu">
          <i class="fas fa-bars"></i>
        </button>
        <span class="buyer-mobile-title">${escapeHtml(title || "BuyForMe")}</span>
        <button type="button" class="buyer-notif-bell buyer-notif-bell--mobile" id="buyerNotifBellMobile" aria-label="Notifications">
          <i class="fas fa-bell" aria-hidden="true"></i>
          <span class="buyer-notif-dot" id="buyerNotifDotMobile"></span>
        </button>
      </div>
      <div id="buyer-main-slot"></div>
    </div>
  `;

  const bottomNav = document.createElement("nav");
  bottomNav.className = "buyer-bottom-nav";
  bottomNav.setAttribute("aria-label", "Mobile navigation");
  bottomNav.innerHTML = NAV_ITEMS.map((item) => {
    const active = item.key === activeKey ? "active" : "";
    const badge = item.badge ? `<span class="nav-badge" id="bottom-${item.badge}"></span>` : "";
    return `<a href="${item.href}" class="${active}" aria-label="${escapeHtml(item.label)}"
      data-tooltip="${escapeHtml(item.label)}">
      <i class="fas ${item.icon}" aria-hidden="true"></i>
      <span class="bottom-nav-label">${item.label}</span>${badge}
    </a>`;
  }).join("");

  const content = document.getElementById("buyer-content");
  const body = document.body;

  body.insertBefore(grid, body.firstChild);
  body.appendChild(bottomNav);

  const slot = document.getElementById("buyer-main-slot");
  if (content && slot) {
    slot.appendChild(content);
    content.classList.add("buyer-main-inner");
  }

  document.getElementById("shellLogout")?.addEventListener("click", () => {
    performBuyerLogout();
  });

  const sidebar = document.getElementById("buyerSidebar");
  const overlay = document.getElementById("buyerSidebarOverlay");
  const openMenu = () => {
    sidebar?.classList.add("open");
    overlay?.classList.add("open");
  };
  const closeMenu = () => {
    sidebar?.classList.remove("open");
    overlay?.classList.remove("open");
  };
  document.getElementById("buyerMenuBtn")?.addEventListener("click", openMenu);
  overlay?.addEventListener("click", closeMenu);
  document.querySelectorAll(".buyer-nav a, .buyer-bottom-nav a").forEach((a) => {
    a.addEventListener("click", closeMenu);
  });

  applyStoredSidebarState();
  setupSidebarCollapse();
}

function isDesktopSidebar() {
  return window.matchMedia(DESKTOP_SIDEBAR_MQ).matches;
}

function isSidebarCollapsedStored() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function setSidebarCollapsed(collapsed) {
  const btn = document.getElementById("buyerSidebarCollapse");
  const onDesktop = isDesktopSidebar();

  document.body.classList.toggle("buyer-sidebar-collapsed", collapsed && onDesktop);

  if (btn) {
    const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.setAttribute("aria-label", label);
    btn.dataset.tooltip = label;
    const icon = btn.querySelector("i");
    if (icon) {
      icon.className = collapsed ? "fas fa-angles-right" : "fas fa-angles-left";
    }
  }

  if (onDesktop) {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
}

function applyStoredSidebarState() {
  if (isDesktopSidebar() && isSidebarCollapsedStored()) {
    document.body.classList.add("buyer-sidebar-collapsed");
    const btn = document.getElementById("buyerSidebarCollapse");
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-label", "Expand sidebar");
      btn.dataset.tooltip = "Expand sidebar";
      const icon = btn.querySelector("i");
      if (icon) icon.className = "fas fa-angles-right";
    }
  }
}

function setupSidebarCollapse() {
  const btn = document.getElementById("buyerSidebarCollapse");
  if (!btn || sidebarCollapseBound) return;

  btn.addEventListener("click", () => {
    if (!isDesktopSidebar()) return;
    const collapsed = document.body.classList.contains("buyer-sidebar-collapsed");
    setSidebarCollapsed(!collapsed);
  });

  window.addEventListener("resize", () => {
    if (isDesktopSidebar()) {
      applyStoredSidebarState();
    } else {
      document.body.classList.remove("buyer-sidebar-collapsed");
    }
  });

  sidebarCollapseBound = true;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function updateNavBadges() {
  if (!shellUser?.uid) return;

  const counts = await refreshBuyerBadges();

  const setBadge = (id, n) => {
    document.querySelectorAll(`#shell-${id}, #bottom-${id}`).forEach((el) => {
      if (!el) return;
      if (n > 0) {
        el.textContent = n > 9 ? "9+" : String(n);
        el.classList.add("show");
      } else {
        el.classList.remove("show");
      }
    });
  };

  setBadge("ordersBadge", counts.orders);
  setBadge("messagesBadge", counts.messages);
}

/**
 * @param {"discover"|"orders"|"messages"|"account"|"profile"|"request"} activeTab
 * @param {{ title?: string, narrow?: boolean, chat?: boolean, skipAuth?: boolean, user?: object }} options
 */
export async function initBuyerShell(activeTab, options = {}) {
  if (options.user) shellUser = options.user;

  if (document.body.dataset.shellInit === "1") {
    await updateNavBadges();
    setupSidebarCollapse();
    applyStoredSidebarState();
    if (shellUser?.uid) {
      initBuyerNotifications(shellUser, { toast: showBuyerToast });
    }
    return shellUser;
  }
  document.body.dataset.shellInit = "1";

  const chat = options.chat || activeTab === "messages";
  if (chat) document.body.classList.add("buyer-app--chat");

  if (!options.skipAuth) {
    const ok = await ensureBuyerAuth();
    if (!ok) return null;
  } else if (!shellUser?.uid) {
    console.warn("initBuyerShell: skipAuth without user — shell UI only");
  }

  const titles = {
    discover: "Discover",
    orders: "My Orders",
    messages: "Messages",
    account: "Account",
    profile: "Shopper Profile",
    request: "Send Request",
  };

  injectShell(
    ["profile", "request"].includes(activeTab) ? "discover" : activeTab,
    options.title || titles[activeTab] || "BuyForMe"
  );

  const content = document.getElementById("buyer-content");
  if (content) {
    if (options.narrow) content.classList.add("buyer-main-inner--narrow");
    if (chat) content.classList.add("buyer-main-inner--chat");
  }

  document.body.classList.add("buyer-app-body");

  await updateNavBadges();
  if (shellUser?.uid) {
    initBuyerNotifications(shellUser, { toast: showBuyerToast });
  }

  document.addEventListener("bfm-buyer-badges", () => {
    updateNavBadges();
  });

  return shellUser;
}

export function getShellUser() {
  return shellUser;
}
