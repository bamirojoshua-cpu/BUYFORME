/* Buyer app shell — sidebar, bottom nav, auth, badges */

import { supabase } from "./supabase.js";
import { getShopperDashboardHref } from "./app-paths.js";

const NAV_ITEMS = [
  { key: "discover", href: "buyers.html", icon: "fa-compass", label: "Discover" },
  { key: "orders", href: "my-orders.html", icon: "fa-bag-shopping", label: "Orders", badge: "ordersBadge" },
  { key: "messages", href: "chat.html", icon: "fa-message", label: "Messages", badge: "messagesBadge" },
  { key: "account", href: "buyers.html?settings=1", icon: "fa-user", label: "Account" },
];

let shellUser = null;

export function showBuyerToast(message, duration = 4000) {
  let el = document.getElementById("buyerToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "buyerToast";
    el.className = "buyer-toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove("show"), duration);
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
    return `<li><a href="${item.href}" class="${active}" data-nav="${item.key}">
      <i class="fas ${item.icon}"></i> ${item.label} ${badge}
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
        <a href="index.html" class="brand-link"><img src="images/logo.png" alt="BuyForMe" class="brand-logo brand-logo--sm"></a>
      </div>
      <div class="buyer-sidebar__user">
        <div class="buyer-sidebar__avatar" id="shellAvatar">${initial}</div>
        <p class="buyer-sidebar__name">${escapeHtml(firstName)}</p>
        <p class="buyer-sidebar__role">Buyer account</p>
      </div>
      <ul class="buyer-nav">${buildNavLinks(activeKey)}</ul>
      <div class="buyer-sidebar__foot">
        <button type="button" class="buyer-sidebar__logout" id="shellLogout">
          <i class="fas fa-right-from-bracket"></i> Log out
        </button>
      </div>
    </aside>
    <div class="buyer-main">
      <div class="buyer-mobile-bar">
        <button type="button" class="buyer-menu-btn" id="buyerMenuBtn" aria-label="Open menu">
          <i class="fas fa-bars"></i>
        </button>
        <span class="buyer-mobile-title">${escapeHtml(title || "BuyForMe")}</span>
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
    return `<a href="${item.href}" class="${active}"><i class="fas ${item.icon}"></i>${item.label}${badge}</a>`;
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

  document.getElementById("shellLogout")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.assign("auth.html");
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

  const { count: pendingOrders } = await supabase
    .from("requests")
    .select("*", { count: "exact", head: true })
    .eq("buyer_id", shellUser.uid)
    .in("status", ["accepted", "delivering"]);

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

  setBadge("ordersBadge", pendingOrders || 0);
}

/**
 * @param {"discover"|"orders"|"messages"|"account"|"profile"|"request"} activeTab
 * @param {{ title?: string, narrow?: boolean, chat?: boolean, skipAuth?: boolean }} options
 */
export async function initBuyerShell(activeTab, options = {}) {
  if (document.body.dataset.shellInit === "1") {
    await updateNavBadges();
    return shellUser;
  }
  document.body.dataset.shellInit = "1";

  const chat = options.chat || activeTab === "messages";
  if (chat) document.body.classList.add("buyer-app--chat");

  if (!options.skipAuth) {
    const ok = await ensureBuyerAuth();
    if (!ok) return null;
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
  return shellUser;
}

export function getShellUser() {
  return shellUser;
}
