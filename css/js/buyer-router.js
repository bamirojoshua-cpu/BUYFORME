/**
 * Buyer tab router — instant in-app navigation between main tabs.
 * Prefetches pages, swaps #buyer-content with motion, uses History API.
 */

import { warmBuyerCache } from "./app-cache.js";
import { setBuyerNavActive, ensureBuyerContentInSlot } from "./buyer-shell.js";
import { ensureBuyerOverlays } from "./buyer-overlays.js";
import { setActiveChatPartner } from "./buyer-notifications.js";
import { supabase } from "./supabase.js";

const TAB_ROUTES = {
  "buyers.html": {
    tab: "discover",
    title: "Discover",
    module: () => import("./buyers.js"),
    mount: "mountBuyersPage",
  },
  "wishlist.html": {
    tab: "wishlist",
    title: "Wishlist",
    module: () => import("./wishlist-page.js"),
    mount: "mountWishlistPage",
  },
  "cart.html": {
    tab: "cart",
    title: "Cart",
    module: () => import("./cart-page.js"),
    mount: "mountCartPage",
  },
  "my-orders.html": {
    tab: "orders",
    title: "My Orders",
    module: () => import("./my-orders.js"),
    mount: "mountOrdersPage",
  },
  "chat.html": {
    tab: "messages",
    title: "Messages",
    chat: true,
    module: () => import("./chat.js"),
    mount: "mountChatPage",
  },
};

const htmlCache = new Map();
const stylesheetCache = new Set();
let navigating = false;
let routerReady = false;
let currentTab = null;

function normalizePage(href) {
  try {
    const url = new URL(href, window.location.href);
    const file = url.pathname.split("/").pop() || "buyers.html";
    return { file, search: url.search, hash: url.hash };
  } catch {
    return { file: "buyers.html", search: "", hash: "" };
  }
}

function routeForFile(file) {
  return TAB_ROUTES[file] || null;
}

function isTabLink(anchor) {
  if (!anchor?.href) return false;
  const { file } = normalizePage(anchor.href);
  return Boolean(routeForFile(file));
}

function applyBodyPageState(parsed, route) {
  const collapsed = document.body.classList.contains("buyer-sidebar-collapsed");

  document.body.classList.remove("buyer-app--chat");
  document.body.classList.add("buyer-app", "buyer-app-body");
  document.body.classList.toggle("buyer-sidebar-collapsed", collapsed);
  document.body.classList.toggle("buyer-app--chat", Boolean(route.chat));
  document.body.dataset.buyerTab = parsed.buyerTab || route.tab;
}

function waitForAnimation(el, fallbackMs = 200) {
  return new Promise((resolve) => {
    if (!el) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener("animationend", onEnd);
      resolve();
    };
    const onEnd = (e) => {
      if (e.target === el) finish();
    };
    el.addEventListener("animationend", onEnd);
    setTimeout(finish, fallbackMs);
  });
}

function ensureNavProgress() {
  let bar = document.getElementById("bfmNavProgress");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "bfmNavProgress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
  }
  return bar;
}

function showNavProgress() {
  ensureNavProgress().classList.add("is-active");
}

function hideNavProgress() {
  document.getElementById("bfmNavProgress")?.classList.remove("is-active");
}

async function fetchPageHtml(file) {
  if (htmlCache.has(file)) return htmlCache.get(file);
  const res = await fetch(file, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Failed to load ${file}`);
  const html = await res.text();
  htmlCache.set(file, html);
  return html;
}

function parseBuyerPage(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const content = doc.querySelector("#buyer-content");
  if (!content) throw new Error("Missing #buyer-content");

  const stylesheets = [...doc.querySelectorAll('link[rel="stylesheet"]')]
    .map((l) => l.getAttribute("href"))
    .filter(Boolean);

  return {
    contentHtml: content.innerHTML,
    contentClass: content.className,
    title: doc.querySelector("title")?.textContent?.trim() || "BuyForMe",
    bodyClass: doc.body.className,
    buyerTab: doc.body.dataset.buyerTab || "",
    stylesheets,
  };
}

function loadStylesheet(href) {
  if (stylesheetCache.has(href) || document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) {
    stylesheetCache.add(href);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => {
      stylesheetCache.add(href);
      resolve();
    };
    link.onerror = reject;
    document.head.appendChild(link);
  });
}

async function ensureStylesheets(hrefs) {
  const unique = [...new Set(hrefs)];
  await Promise.all(unique.map((href) => loadStylesheet(href).catch(() => {})));
}

function closeBuyerSettingsOverlay() {
  const overlay = document.getElementById("settingsOverlay");
  if (!overlay?.classList.contains("open")) return;
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
}

function pulseNav(tab) {
  const file = getFileForTab(tab);
  document.querySelectorAll(".buyer-nav a, .buyer-bottom-nav a").forEach((a) => {
    if (normalizePage(a.href).file !== file) return;
    a.classList.remove("bfm-nav-just-active");
    void a.offsetWidth;
    a.classList.add("bfm-nav-just-active");
    setTimeout(() => a.classList.remove("bfm-nav-just-active"), 400);
  });
}

function getFileForTab(tab) {
  return Object.entries(TAB_ROUTES).find(([, r]) => r.tab === tab)?.[0] || "";
}

export function prefetchBuyerTabs() {
  if (!routerReady) return;
  const run = () => {
    Object.keys(TAB_ROUTES).forEach((file) => {
      fetchPageHtml(file).catch(() => {});
      prefetchTabData(file);
    });
  };
  if ("requestIdleCallback" in window) {
    requestIdleCallback(run, { timeout: 2500 });
  } else {
    setTimeout(run, 800);
  }
}

function prefetchTabData(file) {
  const uid = window.__bfmCacheUid;
  if (!uid) return;

  const route = routeForFile(file);
  if (!route) return;

  switch (route.tab) {
    case "discover":
      import("./api/users.js").then((m) => m.fetchAllPublicShoppers()).catch(() => {});
      break;
    case "wishlist":
      import("./api/wishlist.js").then((m) => m.fetchWishlist(uid)).catch(() => {});
      break;
    case "cart":
      import("./api/cart.js").then((m) => m.fetchCart(uid)).catch(() => {});
      break;
    case "orders":
      import("./api/orders.js").then((m) => m.fetchOrdersForBuyer(uid)).catch(() => {});
      break;
    case "messages":
      import("./chat-local.js").then((m) => m.getConversationSummaries(uid)).catch(() => {});
      break;
    default:
      warmBuyerCache(uid);
  }
}

export async function navigateBuyerTab(href, { replace = false, skipAnimation = false } = {}) {
  const { file, search, hash } = normalizePage(href);
  const route = routeForFile(file);
  if (!route || navigating) return false;

  const targetUrl = `${file}${search}${hash}`;
  const samePage =
    normalizePage(window.location.href).file === file &&
    window.location.search === search &&
    window.location.hash === hash;

  if (samePage && !replace) return true;

  navigating = true;
  showNavProgress();

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    hideNavProgress();
    navigating = false;
    window.location.assign("auth.html");
    return false;
  }

  const slot = document.getElementById("buyer-content");

  try {
    if (slot && !skipAnimation) {
      slot.classList.remove("bfm-page-enter");
      slot.classList.add("bfm-page-exit");
      await waitForAnimation(slot, 180);
    }

    if (currentTab === "messages" && route.tab !== "messages") {
      setActiveChatPartner(null);
    }

    if (route.tab !== "discover") {
      closeBuyerSettingsOverlay();
    }

    const html = await fetchPageHtml(file);
    const parsed = parseBuyerPage(html);
    await ensureStylesheets(parsed.stylesheets);

    if (!slot) throw new Error("Missing content slot");

    slot.className = parsed.contentClass;
    slot.classList.add("buyer-main-inner");
    slot.classList.remove("bfm-page-exit");
    slot.innerHTML = parsed.contentHtml;

    applyBodyPageState(parsed, route);
    ensureBuyerContentInSlot();
    ensureBuyerOverlays();
    slot.classList.toggle("buyer-main-inner--chat", Boolean(route.chat));
    slot.classList.remove("buyer-main-inner--narrow");
    document.body.dataset.shellInit = "1";

    setBuyerNavActive(route.tab, route.title);
    pulseNav(route.tab);
    document.title = parsed.title;

    const mod = await route.module();
    const mountFn = mod[route.mount];
    if (typeof mountFn !== "function") {
      throw new Error(`Missing ${route.mount}`);
    }
    await mountFn();

    const state = { bfmTab: route.tab, file, search, hash };
    if (replace) {
      history.replaceState(state, "", targetUrl);
    } else {
      history.pushState(state, "", targetUrl);
    }

    currentTab = route.tab;

    slot.classList.add("bfm-page-enter");
    requestAnimationFrame(() => {
      slot.classList.remove("bfm-page-enter");
    });

    document.dispatchEvent(
      new CustomEvent("bfm-buyer-nav", { detail: { tab: route.tab, file } })
    );

    return true;
  } catch (err) {
    console.warn("Soft nav failed, falling back:", err);
    window.location.assign(targetUrl);
    return false;
  } finally {
    hideNavProgress();
    navigating = false;
  }
}

function onLinkClick(event) {
  if (event.defaultPrevented) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (event.button !== 0) return;

  const link = event.target.closest("a[href]");
  if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
  if (!isTabLink(link)) return;

  event.preventDefault();
  navigateBuyerTab(link.href);
}

function onPopState() {
  const { file, search, hash } = normalizePage(window.location.href);
  const route = routeForFile(file);
  if (!route) {
    window.location.assign(`${file}${search}${hash}`);
    return;
  }
  navigateBuyerTab(`${file}${search}${hash}`, { replace: true });
}

export function initBuyerRouter(activeTab) {
  if (routerReady) return;
  routerReady = true;
  currentTab = activeTab;

  const { file, search, hash } = normalizePage(window.location.href);
  history.replaceState(
    { bfmTab: activeTab, file, search, hash },
    "",
    `${file}${search}${hash}`
  );

  document.addEventListener("click", onLinkClick, true);
  window.addEventListener("popstate", onPopState);

  document.querySelectorAll(".buyer-nav a, .buyer-bottom-nav a").forEach((a) => {
    const { file: f } = normalizePage(a.href);
    if (routeForFile(f)) {
      a.addEventListener("mouseenter", () => {
        fetchPageHtml(f).catch(() => {});
        prefetchTabData(f);
      }, { passive: true });
      a.addEventListener("focus", () => {
        fetchPageHtml(f).catch(() => {});
        prefetchTabData(f);
      }, { passive: true });
    }
  });

  prefetchBuyerTabs();
}

/** Full page loads call this; router handles soft navigations separately. */
export function shouldAutoMountPage() {
  return !navigating;
}
