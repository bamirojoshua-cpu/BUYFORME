/* =============================================================
   BuyForMe — Buyer Dashboard
   ============================================================= */

import { supabase } from "./supabase.js";
import { getShopperDashboardHref } from "./app-paths.js";
import { nameWithVerifiedBadge } from "./verified-badge.js";
import { initBuyerShell, showBuyerToast, performBuyerLogout } from "./buyer-shell.js";

let currentUser = { id: "", name: "Buyer", email: "", role: "buyer" };
let allShoppers = [];

const filters = ["All", "Turkey", "China", "UK", "USA", "Fashion", "Electronics", "Furniture"];
const filterIcons = {
  All: "fa-globe",
  Turkey: "fa-flag",
  China: "fa-flag",
  UK: "fa-flag",
  USA: "fa-flag",
  Fashion: "fa-shirt",
  Electronics: "fa-laptop",
  Furniture: "fa-couch",
};

const bannerGradients = [
  ["#0f766e", "#16a34a"],
  ["#7c3aed", "#a855f7"],
  ["#d97706", "#f59e0b"],
  ["#059669", "#10b981"],
  ["#dc2626", "#f87171"],
  ["#2563eb", "#3b82f6"],
  ["#0891b2", "#06b6d4"],
  ["#9333ea", "#c084fc"],
];

let activeFilter = "All";
let searchTerm = "";
let sortBy = "rating";

const FEATURED_SHOPPER_LIMIT = 5;

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showGridLoading() {
  const grid = document.getElementById("shopperGrid");
  if (!grid) return;
  grid.classList.add("is-loading");
  grid.setAttribute("aria-busy", "true");
  grid.innerHTML = Array.from({ length: 6 }, () => `
    <article class="shopper-card shopper-card--skeleton" aria-hidden="true">
      <div class="card-banner"></div>
      <div class="card-body">
        <div class="sk-line sk-line--wide"></div>
        <div class="sk-line sk-line--mid"></div>
        <div class="sk-line sk-line--btn"></div>
      </div>
    </article>
  `).join("");
}

function mapProfile(profile) {
  currentUser = {
    id: profile.uid,
    name: profile.name || "Buyer",
    email: profile.email || "",
    role: profile.role || "buyer",
    address: profile.address || "",
    city: profile.city || "",
    country: profile.country || "",
    currency: profile.currency || "",
    payment: profile.payment || "",
  };
}

async function initAuth() {
  const profile = await initBuyerShell("discover");
  if (!profile) return;
  mapProfile(profile);

  updateNavUser();
  renderFilters();
  showGridLoading();
  await loadShoppers();
  switchTab("profile");

  if (new URLSearchParams(window.location.search).get("settings") === "1") {
    toggleSettings();
  }
}

async function loadShoppers() {
  const { data, error } = await supabase.from("public_shoppers").select("*");

  if (error) {
    console.error("Failed to load shoppers:", error);
    const grid = document.getElementById("shopperGrid");
    if (grid) {
      grid.classList.remove("is-loading");
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon"><i class="fas fa-triangle-exclamation"></i></div>
          <h3>Could not load shoppers</h3>
          <p>Please refresh the page or try again in a moment.</p>
          <button type="button" onclick="location.reload()">Refresh</button>
        </div>`;
    }
    return;
  }

  allShoppers = data || [];
  renderFeatured();
  renderShoppers();
}

function parseFee(feeStr) {
  if (!feeStr) return 999;
  const m = String(feeStr).match(/\d+/);
  return m ? parseInt(m[0], 10) : 999;
}

function sortShoppers(list) {
  const copy = [...list];
  switch (sortBy) {
    case "reviews":
      return copy.sort((a, b) => (Number(b.review_count) || 0) - (Number(a.review_count) || 0));
    case "fee":
      return copy.sort((a, b) => parseFee(a.fee) - parseFee(b.fee));
    case "name":
      return copy.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    case "rating":
    default:
      return copy.sort((a, b) => {
        const ar = a.rating === "New" ? 0 : parseFloat(a.rating) || 0;
        const br = b.rating === "New" ? 0 : parseFloat(b.rating) || 0;
        return br - ar;
      });
  }
}

function renderFeatured() {
  const section = document.getElementById("featuredSection");
  const grid = document.getElementById("featuredGrid");
  if (!section || !grid || allShoppers.length === 0) return;

  const top = sortShoppers([...allShoppers]).slice(0, FEATURED_SHOPPER_LIMIT);
  section.hidden = false;
  grid.innerHTML = top
    .map((s) => {
      const initial = (s.name || "S")[0].toUpperCase();
      const av = s.avatar_url
        ? `<img src="${escapeHtml(s.avatar_url)}" alt="">`
        : initial;
      return `
      <article class="featured-card" data-shopper-id="${escapeHtml(s.uid)}" tabindex="0">
        <div class="featured-card__avatar">${av}</div>
        <p class="featured-card__name">${escapeHtml(s.name || "Shopper")}</p>
        <p class="featured-card__meta">${escapeHtml(s.location || "—")}</p>
      </article>`;
    })
    .join("");

  grid.querySelectorAll(".featured-card").forEach((card) => {
    const go = () => goToProfile(card.dataset.shopperId);
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
    });
  });
}

function updateNavUser() {
  const initial = (currentUser.name || "B")[0].toUpperCase();
  const shellAvatar = document.getElementById("shellAvatar");
  if (shellAvatar) shellAvatar.textContent = initial;
  const welcomeMsg = document.getElementById("welcomeMsg");
  if (welcomeMsg) {
    welcomeMsg.textContent = `Welcome back, ${currentUser.name.split(" ")[0]}`;
  }
}

function prefillProfile() {
  const nameInput = document.getElementById("settingName");
  const emailInput = document.getElementById("settingEmail");
  if (nameInput) nameInput.value = currentUser.name;
  if (emailInput) emailInput.value = currentUser.email;
}

function renderFilters() {
  const filterPills = document.getElementById("filterPills");
  if (!filterPills) return;

  filterPills.innerHTML = filters
    .map((f) => {
      const icon = filterIcons[f] || "fa-tag";
      const active = f === activeFilter ? "active" : "";
      return `
    <button type="button" class="filter-pill ${active}" role="tab"
      aria-selected="${f === activeFilter}"
      data-filter="${escapeHtml(f)}">${f === "All" ? "" : `<i class="fas ${icon}"></i> `}${escapeHtml(f)}</button>`;
    })
    .join("");

  filterPills.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => setFilter(btn.dataset.filter));
  });
}

function renderShoppers() {
  const visible = sortShoppers(allShoppers.filter((s) => {
    const location = (s.location || "").toLowerCase();
    const name = (s.name || "").toLowerCase();
    const about = (s.about || "").toLowerCase();
    const tags = (s.tags || "").toLowerCase();

    const matchFilter =
      activeFilter === "All" ||
      location.includes(activeFilter.toLowerCase()) ||
      tags.includes(activeFilter.toLowerCase());

    const matchSearch =
      !searchTerm ||
      name.includes(searchTerm) ||
      location.includes(searchTerm) ||
      about.includes(searchTerm) ||
      tags.includes(searchTerm);

    return matchFilter && matchSearch;
  }));

  const resultCount = document.getElementById("resultCount");
  if (resultCount) {
    resultCount.textContent = `${visible.length} available`;
  }

  const grid = document.getElementById("shopperGrid");
  if (!grid) return;

  grid.classList.remove("is-loading");
  grid.setAttribute("aria-busy", "false");

  if (visible.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"><i class="fas fa-magnifying-glass"></i></div>
        <h3>No shoppers found</h3>
        <p>Try a different search term or clear your filters.</p>
        <button type="button" id="clearFiltersBtn">Clear filters</button>
      </div>`;
    document.getElementById("clearFiltersBtn")?.addEventListener("click", () => {
      activeFilter = "All";
      searchTerm = "";
      const searchBar = document.getElementById("searchBar");
      if (searchBar) searchBar.value = "";
      renderFilters();
      renderShoppers();
    });
    return;
  }

  grid.innerHTML = visible
    .map((s, index) => {
      const [from, to] = bannerGradients[index % bannerGradients.length];
      const initial = (s.name || "S")[0].toUpperCase();
      const delay = Math.min(index * 0.04, 0.4);

      const avatarInner = s.avatar_url
        ? `<img src="${escapeHtml(s.avatar_url)}" alt="">`
        : escapeHtml(initial);

      const location = s.location || "Location not set";
      const rating = s.rating ?? "New";
      const reviews = s.review_count ?? "0";
      const orders = s.completion_rate ? `${s.completion_rate}+` : "0+";
      const fee = s.fee ? escapeHtml(s.fee) : null;

      const tagList = s.tags
        ? String(s.tags)
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 3)
        : [];

      const tagsHTML =
        tagList.length > 0
          ? `<div class="shopper-tags">${tagList.map((t) => `<span class="shopper-tag">${escapeHtml(t)}</span>`).join("")}</div>`
          : "";

      const ratingDisplay =
        rating === "New"
          ? "New"
          : `<i class="fas fa-star"></i>${escapeHtml(String(rating))}`;

      return `
      <article class="shopper-card" style="animation-delay:${delay}s" data-shopper-id="${escapeHtml(s.uid)}" tabindex="0">
        <div class="card-banner" style="--banner-from:${from};--banner-to:${to};background:linear-gradient(135deg,${from},${to})">
          <div class="card-avatar">${avatarInner}</div>
        </div>
        <div class="card-body">
          <div class="card-name-row">
            ${nameWithVerifiedBadge(s.name || "Shopper", { tag: "h3", className: "card-name" })}
          </div>
          <p class="card-location"><i class="fas fa-location-dot"></i> ${escapeHtml(location)}</p>
          <div class="card-stats">
            <div class="card-stat"><strong>${ratingDisplay}</strong><span>Rating</span></div>
            <div class="card-stat"><strong>${escapeHtml(String(reviews))}</strong><span>Reviews</span></div>
            <div class="card-stat"><strong>${escapeHtml(String(orders))}</strong><span>Orders</span></div>
          </div>
          ${fee ? `<p class="card-fee"><i class="fas fa-percent"></i> Service fee: ${fee}</p>` : ""}
          ${tagsHTML}
          ${s.response_time ? `<p class="card-response"><i class="fas fa-clock"></i> Responds ${escapeHtml(s.response_time)}</p>` : ""}
          <div class="card-actions-row">
            <button type="button" class="btn-view-profile" data-action="profile" data-shopper-id="${escapeHtml(s.uid)}">
              View profile <i class="fas fa-arrow-right"></i>
            </button>
            <button type="button" class="btn-card-msg" data-action="message" data-shopper-id="${escapeHtml(s.uid)}" data-shopper-name="${escapeHtml(s.name || "Shopper")}" aria-label="Message shopper">
              <i class="fas fa-message"></i>
            </button>
          </div>
        </div>
      </article>`;
    })
    .join("");

  grid.querySelectorAll(".shopper-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      goToProfile(card.dataset.shopperId);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.target.closest("button")) goToProfile(card.dataset.shopperId);
    });
  });

  grid.querySelectorAll('[data-action="profile"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      goToProfile(btn.dataset.shopperId);
    });
  });

  grid.querySelectorAll('[data-action="message"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const uid = btn.dataset.shopperId;
      const name = btn.dataset.shopperName || "Shopper";
      window.location.assign(`chat.html?with=${encodeURIComponent(uid)}&name=${encodeURIComponent(name)}`);
    });
  });
}

window.setFilter = function (f) {
  activeFilter = f;
  renderFilters();
  renderShoppers();
};

window.goToProfile = function (uid) {
  if (!uid) return;
  window.location.assign(`shopper-profile.html?id=${encodeURIComponent(uid)}`);
};

window.toggleSettings = function () {
  const overlay = document.getElementById("settingsOverlay");
  const open = overlay.classList.toggle("open");
  overlay.setAttribute("aria-hidden", open ? "false" : "true");
};

window.closeSettings = function (e) {
  if (e.target === document.getElementById("settingsOverlay")) {
    const overlay = document.getElementById("settingsOverlay");
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
  }
};

function setActiveSettingsTab(tab) {
  document.querySelectorAll(".settings-tab").forEach((b) => {
    const isActive = b.dataset.tab === tab;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

function setSettingsMsg(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.className = "settings-msg";
  if (type === "success") el.classList.add("is-success");
  if (type === "error") el.classList.add("is-error");
}

window.switchTab = function (tab) {
  setActiveSettingsTab(tab);
  const form = document.getElementById("settingsForm");
  if (!form) return;

  if (tab === "profile") {
    const notifOn = currentUser.notifications !== false;
    form.innerHTML = `
      <label for="settingName">Full name</label>
      <input type="text" id="settingName" value="${escapeHtml(currentUser.name)}" placeholder="Your name" autocomplete="name">
      <label for="settingEmail">Email</label>
      <input type="email" id="settingEmail" value="${escapeHtml(currentUser.email)}" placeholder="you@email.com" autocomplete="email">
      <div class="settings-toggle-row toggle-row">
        <span>Push &amp; in-app notifications</span>
        <button type="button" class="toggle-track ${notifOn ? "on" : ""}" id="buyerNotifToggle" aria-pressed="${notifOn}">
          <span class="toggle-thumb"></span>
        </button>
      </div>
      <p class="settings-hint">Alerts for new messages, order updates, and activity in the notification bell.</p>
      <button type="button" class="btn-save" onclick="saveProfile()"><i class="fas fa-check"></i> Save changes</button>
      <p class="settings-msg" id="profileMsg" role="status"></p>`;
    document.getElementById("buyerNotifToggle")?.addEventListener("click", function () {
      this.classList.toggle("on");
      this.setAttribute("aria-pressed", this.classList.contains("on"));
    });
  } else if (tab === "shipping") {
    form.innerHTML = `
      <label for="settingAddress">Street address</label>
      <input type="text" id="settingAddress" value="${escapeHtml(currentUser.address)}" placeholder="e.g. 12 Accra Road">
      <label for="settingCity">City</label>
      <input type="text" id="settingCity" value="${escapeHtml(currentUser.city)}" placeholder="e.g. Lagos">
      <label for="settingCountry">Country</label>
      <input type="text" id="settingCountry" value="${escapeHtml(currentUser.country)}" placeholder="e.g. Nigeria">
      <button type="button" class="btn-save" onclick="saveShipping()"><i class="fas fa-check"></i> Save address</button>
      <p class="settings-msg" id="shippingMsg" role="status"></p>`;
  } else if (tab === "payments") {
    form.innerHTML = `
      <label for="settingCurrency">Preferred currency</label>
      <input type="text" id="settingCurrency" value="${escapeHtml(currentUser.currency)}" placeholder="e.g. USD, NGN">
      <label for="settingPayment">Mobile money / bank</label>
      <input type="text" id="settingPayment" value="${escapeHtml(currentUser.payment)}" placeholder="e.g. MTN MoMo">
      <button type="button" class="btn-save" onclick="savePayments()"><i class="fas fa-check"></i> Save payment info</button>
      <p class="settings-msg" id="paymentsMsg" role="status"></p>`;
  }
};

window.saveProfile = async function () {
  const name = document.getElementById("settingName")?.value.trim();
  const email = document.getElementById("settingEmail")?.value.trim();
  const msg = document.getElementById("profileMsg");

  if (!name || !email) {
    setSettingsMsg(msg, "Please fill in all fields.", "error");
    return;
  }

  setSettingsMsg(msg, "Saving…", null);

  const notifications = document.getElementById("buyerNotifToggle")?.classList.contains("on") ?? true;

  const { error } = await supabase
    .from("users")
    .update({ name, email, notifications })
    .eq("uid", currentUser.id);

  if (error) {
    setSettingsMsg(msg, "Failed to save. Please try again.", "error");
    return;
  }

  currentUser.name = name;
  currentUser.email = email;
  currentUser.notifications = notifications;

  if (notifications && typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
  updateNavUser();
  setSettingsMsg(msg, "Profile updated successfully.", "success");
  showBuyerToast("Profile saved");
};

window.saveShipping = async function () {
  const address = document.getElementById("settingAddress")?.value.trim();
  const city = document.getElementById("settingCity")?.value.trim();
  const country = document.getElementById("settingCountry")?.value.trim();
  const msg = document.getElementById("shippingMsg");

  setSettingsMsg(msg, "Saving…", null);

  const { error } = await supabase
    .from("users")
    .update({ address, city, country })
    .eq("uid", currentUser.id);

  if (error) {
    setSettingsMsg(msg, "Failed to save. Please try again.", "error");
    return;
  }

  currentUser.address = address;
  currentUser.city = city;
  currentUser.country = country;
  setSettingsMsg(msg, "Address saved successfully.", "success");
  showBuyerToast("Address saved");
};

window.savePayments = async function () {
  const currency = document.getElementById("settingCurrency")?.value.trim();
  const payment = document.getElementById("settingPayment")?.value.trim();
  const msg = document.getElementById("paymentsMsg");

  setSettingsMsg(msg, "Saving…", null);

  const { error } = await supabase
    .from("users")
    .update({ currency, payment })
    .eq("uid", currentUser.id);

  if (error) {
    setSettingsMsg(msg, "Failed to save. Please try again.", "error");
    return;
  }

  currentUser.currency = currency;
  currentUser.payment = payment;
  setSettingsMsg(msg, "Payment info saved successfully.", "success");
  showBuyerToast("Payment info saved");
};

window.handleLogout = performBuyerLogout;

document.addEventListener("DOMContentLoaded", () => {
  initAuth();

  const searchBar = document.getElementById("searchBar");
  if (searchBar) {
    let debounce;
    searchBar.addEventListener("input", (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        searchTerm = e.target.value.toLowerCase().trim();
        renderShoppers();
      }, 200);
    });
  }

  document.getElementById("sortSelect")?.addEventListener("change", (e) => {
    sortBy = e.target.value;
    renderShoppers();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const overlay = document.getElementById("settingsOverlay");
      if (overlay?.classList.contains("open")) {
        overlay.classList.remove("open");
        overlay.setAttribute("aria-hidden", "true");
      }
    }
  });
});
