/* =============================================================
   BuyForMe — Buyer Dashboard
   ============================================================= */

import { supabase } from "./supabase.js";
import { getShopperDashboardHref } from "./app-paths.js";
import { nameWithVerifiedBadge, plainNameFromElement } from "./verified-badge.js";
import { initBuyerShell, showBuyerToast, performBuyerLogout, updateShellUserDisplay } from "./buyer-shell.js";
import { createTicket, fetchMyTickets } from "./api/tickets.js";
import { fetchAllPublicShoppers } from "./api/users.js";
import { isEmail, required, validate as runValidators } from "./validators/forms.js";

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
    uid: profile.uid,
    name: profile.name || "Buyer",
    email: profile.email || "",
    role: profile.role || "buyer",
    address: profile.address || "",
    city: profile.city || "",
    country: profile.country || "",
    currency: profile.currency || "",
    payment: profile.payment || "",
    avatar_url: profile.avatar_url || "",
    notifications: profile.notifications !== false,
    saved_addresses: parseSavedAddresses(profile.saved_addresses),
  };
}

function parseSavedAddresses(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function defaultAddressFromProfile() {
  if (!currentUser.address && !currentUser.city && !currentUser.country) return null;
  return {
    id: "primary",
    label: "Primary",
    address: currentUser.address || "",
    city: currentUser.city || "",
    country: currentUser.country || "",
    is_default: true,
  };
}

function getAddressBook() {
  const book = [...(currentUser.saved_addresses || [])];
  if (book.length === 0) {
    const legacy = defaultAddressFromProfile();
    if (legacy) book.push(legacy);
  }
  return book;
}

async function persistAddressBook(addresses) {
  currentUser.saved_addresses = addresses;
  const primary = addresses.find((a) => a.is_default) || addresses[0];
  const payload = {
    saved_addresses: addresses,
    address: primary?.address || "",
    city: primary?.city || "",
    country: primary?.country || "",
  };
  const { error } = await supabase.from("users").update(payload).eq("uid", currentUser.id);
  if (error) throw error;
  if (primary) {
    currentUser.address = primary.address || "";
    currentUser.city = primary.city || "";
    currentUser.country = primary.country || "";
  }
}

async function initAuth() {
  const profile = await initBuyerShell("discover");
  if (!profile) return;
  mapProfile(profile);

  updateNavUser();
  if (!document.getElementById("filterPills")?.children.length) {
    renderFilters();
  }

  const grid = document.getElementById("shopperGrid");
  const hasCards = grid?.querySelector(".shopper-card:not(.shopper-card--skeleton)");
  if (!hasCards) {
    showGridLoading();
    await loadShoppers();
  } else if (allShoppers.length) {
    renderFeatured();
    renderShoppers();
  }

  if (new URLSearchParams(window.location.search).get("settings") === "1") {
    openSettingsFromQuery();
  }
}

async function loadShoppers() {
  try {
    allShoppers = await fetchAllPublicShoppers({
      onUpdate: (data) => {
        allShoppers = data;
        renderFeatured();
        renderShoppers();
      },
    });
    renderFeatured();
    renderShoppers();
    const grid = document.getElementById("shopperGrid");
    grid?.classList.remove("is-loading");
    grid?.removeAttribute("aria-busy");
  } catch (error) {
    console.error("Failed to load shoppers:", error);
    const grid = document.getElementById("shopperGrid");
    if (grid && !allShoppers.length) {
      grid.classList.remove("is-loading");
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon"><i class="fas fa-triangle-exclamation"></i></div>
          <h3>Could not load shoppers</h3>
          <p>Please refresh the page or try again in a moment.</p>
          <button type="button" onclick="location.reload()">Refresh</button>
        </div>`;
    }
  }
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
  if (shellAvatar) {
    if (currentUser.avatar_url) {
      shellAvatar.innerHTML = `<img src="${escapeHtml(currentUser.avatar_url)}" alt="">`;
    } else {
      shellAvatar.textContent = initial;
    }
  }
  const welcomeMsg = document.getElementById("welcomeMsg");
  if (welcomeMsg) {
    welcomeMsg.textContent = `Welcome back, ${currentUser.name.split(" ")[0]}`;
  }
  updateShellUserDisplay(currentUser);
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
  if (!overlay) return;
  const willOpen = !overlay.classList.contains("open");
  if (willOpen) switchTab("profile");
  overlay.classList.toggle("open", willOpen);
  overlay.setAttribute("aria-hidden", willOpen ? "false" : "true");
};

window.closeSettings = function (e) {
  if (e.target === document.getElementById("settingsOverlay")) {
    const overlay = document.getElementById("settingsOverlay");
    if (!overlay) return;
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

  abortSettingsTabListeners();
  settingsTabAbort = new AbortController();
  const { signal } = settingsTabAbort;

  if (tab === "profile") {
    const notifOn = currentUser.notifications !== false;
    const avInner = currentUser.avatar_url
      ? `<img src="${escapeHtml(currentUser.avatar_url)}" alt="">`
      : (currentUser.name || "B")[0].toUpperCase();
    form.innerHTML = `
      <div class="profile-avatar-upload">
        <div class="profile-avatar-preview" id="profileAvatarPreview">${avInner}</div>
        <div>
          <label class="bfm-btn bfm-btn--secondary bfm-btn--sm" for="profileAvatarInput">
            <i class="fas fa-camera"></i> Change photo
          </label>
          <input type="file" id="profileAvatarInput" accept="image/jpeg,image/png,image/webp" hidden>
          <p class="settings-hint">JPG, PNG or WebP. Max 2 MB.</p>
        </div>
      </div>
      <label for="settingName">Full name</label>
      <input type="text" id="settingName" class="bfm-input" value="${escapeHtml(currentUser.name)}" placeholder="Your name" autocomplete="name">
      <label for="settingEmail">Email</label>
      <input type="email" id="settingEmail" class="bfm-input" value="${escapeHtml(currentUser.email)}" placeholder="you@email.com" autocomplete="email">
      <div class="settings-toggle-row toggle-row">
        <span>Push &amp; in-app notifications</span>
        <button type="button" class="toggle-track ${notifOn ? "on" : ""}" id="buyerNotifToggle" aria-pressed="${notifOn}">
          <span class="toggle-thumb"></span>
        </button>
      </div>
      <p class="settings-hint">Alerts for new messages, order updates, and activity in the notification bell.</p>
      <div id="pwaInstallRow" class="settings-toggle-row" hidden>
        <span>Install BuyForMe on this device</span>
        <button type="button" class="bfm-btn bfm-btn--secondary bfm-btn--sm" id="pwaInstallBtn">Install app</button>
      </div>
      <button type="button" class="btn-save" onclick="saveProfile()"><i class="fas fa-check"></i> Save changes</button>
      <p class="settings-msg" id="profileMsg" role="status"></p>`;
    document.getElementById("buyerNotifToggle")?.addEventListener("click", function () {
      this.classList.toggle("on");
      this.setAttribute("aria-pressed", this.classList.contains("on"));
    }, { signal });
    document.getElementById("profileAvatarInput")?.addEventListener("change", handleAvatarSelect, { signal });
    import("./pwa-register.js")
      .then(({ isPwaInstallAvailable, isPwaInstalled, promptPwaInstall, isIosPwaContext }) => {
        const row = document.getElementById("pwaInstallRow");
        const btn = document.getElementById("pwaInstallBtn");
        if (!row || !btn || signal.aborted) return;
        if (isPwaInstallAvailable() && !isPwaInstalled()) {
          row.hidden = false;
          btn.textContent = isIosPwaContext() ? "Add to Home Screen" : "Install app";
          btn.addEventListener("click", () => promptPwaInstall(), { signal });
        }
      })
      .catch(() => {});
  } else if (tab === "shipping") {
    form.innerHTML = `
      <p class="settings-hint" style="margin-bottom:14px">Save delivery addresses for faster checkout on future orders.</p>
      <div class="address-book" id="addressBookList"></div>
      <div class="address-book-form buyer-card" id="addressBookForm">
        <h3 class="address-book-form__title">Add address</h3>
        <label for="addrLabel">Label</label>
        <input type="text" id="addrLabel" class="bfm-input" placeholder="e.g. Home, Office">
        <label for="addrStreet">Street address</label>
        <input type="text" id="addrStreet" class="bfm-input" placeholder="e.g. 12 Accra Road">
        <label for="addrCity">City</label>
        <input type="text" id="addrCity" class="bfm-input" placeholder="e.g. Lagos">
        <label for="addrCountry">Country</label>
        <input type="text" id="addrCountry" class="bfm-input" placeholder="e.g. Nigeria">
        <button type="button" class="btn-save" onclick="addAddress()"><i class="fas fa-plus"></i> Add address</button>
      </div>
      <p class="settings-msg" id="shippingMsg" role="status"></p>`;
    renderAddressBook();
  } else if (tab === "support") {
    form.innerHTML = `
      <p class="settings-hint">Open a ticket — our team typically responds within 24 hours.</p>
      <label for="ticketSubject">Subject</label>
      <input type="text" id="ticketSubject" class="bfm-input" placeholder="Brief summary">
      <label for="ticketBody">Message</label>
      <textarea id="ticketBody" class="bfm-input" rows="4" placeholder="Describe your issue…"></textarea>
      <button type="button" class="btn-save" onclick="submitSupportTicket()"><i class="fas fa-paper-plane"></i> Submit ticket</button>
      <div id="ticketList" class="ticket-list" style="margin-top:20px"></div>
      <p class="settings-msg" id="supportMsg" role="status"></p>`;
    loadMyTickets();
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

  const nameErr = runValidators(name, [required]);
  if (nameErr) { setSettingsMsg(msg, "Please enter your name.", "error"); return; }
  const emailErr = runValidators(email, [required, isEmail]);
  if (emailErr) { setSettingsMsg(msg, emailErr, "error"); return; }

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

async function handleAvatarSelect(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showBuyerToast("Image must be under 2 MB");
    return;
  }

  const preview = document.getElementById("profileAvatarPreview");
  const msg = document.getElementById("profileMsg");
  setSettingsMsg(msg, "Uploading photo…", null);

  try {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${currentUser.id}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (upErr) throw upErr;

    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const avatarUrl = `${data.publicUrl}?t=${Date.now()}`;

    const { error } = await supabase.from("users").update({ avatar_url: avatarUrl }).eq("uid", currentUser.id);
    if (error) throw error;

    currentUser.avatar_url = avatarUrl;
    if (preview) preview.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="">`;
    updateNavUser();
    setSettingsMsg(msg, "Photo updated.", "success");
    showBuyerToast("Profile photo saved");
  } catch (err) {
    console.error("Avatar upload:", err);
    setSettingsMsg(msg, "Could not upload photo. Try again.", "error");
  }
}

function renderAddressBook() {
  const list = document.getElementById("addressBookList");
  if (!list) return;
  const addresses = getAddressBook();

  if (addresses.length === 0) {
    list.innerHTML = `<p class="address-book-empty">No saved addresses yet. Add one below.</p>`;
    return;
  }

  list.innerHTML = addresses
    .map(
      (a) => `
    <article class="address-card${a.is_default ? " address-card--default" : ""}">
      <div class="address-card__head">
        <strong>${escapeHtml(a.label || "Address")}</strong>
        ${a.is_default ? '<span class="address-card__badge">Default</span>' : ""}
      </div>
      <p>${escapeHtml(a.address)}</p>
      <p class="address-card__meta">${escapeHtml([a.city, a.country].filter(Boolean).join(", "))}</p>
      <div class="address-card__actions">
        ${!a.is_default ? `<button type="button" class="btn-pill btn-pill--secondary btn-pill--sm" onclick="setDefaultAddress('${escapeHtml(a.id)}')">Set default</button>` : ""}
        <button type="button" class="btn-pill btn-pill--ghost btn-pill--sm" onclick="removeAddress('${escapeHtml(a.id)}')">Remove</button>
      </div>
    </article>`
    )
    .join("");
}

window.addAddress = async function () {
  const label = document.getElementById("addrLabel")?.value.trim() || "Address";
  const address = document.getElementById("addrStreet")?.value.trim();
  const city = document.getElementById("addrCity")?.value.trim();
  const country = document.getElementById("addrCountry")?.value.trim();
  const msg = document.getElementById("shippingMsg");

  if (!address || !country) {
    setSettingsMsg(msg, "Street address and country are required.", "error");
    return;
  }

  setSettingsMsg(msg, "Saving…", null);
  const book = getAddressBook();
  const entry = {
    id: crypto.randomUUID?.() || `addr-${Date.now()}`,
    label,
    address,
    city,
    country,
    is_default: book.length === 0,
  };
  book.push(entry);

  try {
    await persistAddressBook(book);
    renderAddressBook();
    document.getElementById("addrLabel").value = "";
    document.getElementById("addrStreet").value = "";
    document.getElementById("addrCity").value = "";
    document.getElementById("addrCountry").value = "";
    setSettingsMsg(msg, "Address saved.", "success");
    showBuyerToast("Address added");
  } catch {
    setSettingsMsg(msg, "Failed to save address.", "error");
  }
};

window.setDefaultAddress = async function (id) {
  const msg = document.getElementById("shippingMsg");
  const book = getAddressBook().map((a) => ({ ...a, is_default: a.id === id }));
  try {
    await persistAddressBook(book);
    renderAddressBook();
    setSettingsMsg(msg, "Default address updated.", "success");
  } catch {
    setSettingsMsg(msg, "Could not update default.", "error");
  }
};

window.removeAddress = async function (id) {
  const msg = document.getElementById("shippingMsg");
  let book = getAddressBook().filter((a) => a.id !== id);
  if (book.length && !book.some((a) => a.is_default)) {
    book[0].is_default = true;
  }
  try {
    await persistAddressBook(book);
    renderAddressBook();
    setSettingsMsg(msg, "Address removed.", "success");
  } catch {
    setSettingsMsg(msg, "Could not remove address.", "error");
  }
};

window.submitSupportTicket = async function () {
  const subject = document.getElementById("ticketSubject")?.value.trim();
  const body = document.getElementById("ticketBody")?.value.trim();
  const msg = document.getElementById("supportMsg");
  if (!subject || !body) {
    setSettingsMsg(msg, "Subject and message are required.", "error");
    return;
  }
  setSettingsMsg(msg, "Submitting…", null);
  try {
    await createTicket({
      userId: currentUser.id,
      userName: currentUser.name,
      userEmail: currentUser.email,
      subject,
      body,
    });
    document.getElementById("ticketSubject").value = "";
    document.getElementById("ticketBody").value = "";
    setSettingsMsg(msg, "Ticket submitted. We'll be in touch soon.", "success");
    loadMyTickets();
  } catch {
    setSettingsMsg(msg, "Could not submit — run supabase-phase3.sql", "error");
  }
};

async function loadMyTickets() {
  const list = document.getElementById("ticketList");
  if (!list) return;
  try {
    const tickets = await fetchMyTickets(currentUser.id);
    if (!tickets.length) {
      list.innerHTML = `<p class="settings-hint">No tickets yet.</p>`;
      return;
    }
    list.innerHTML = tickets.map((t) => `
      <article class="ticket-card">
        <strong>${escapeHtml(t.subject)}</strong>
        <span class="ticket-card__status ticket-card__status--${t.status}">${escapeHtml(t.status)}</span>
        <p>${escapeHtml(t.body)}</p>
        <time>${new Date(t.created_at).toLocaleDateString()}</time>
      </article>`).join("");
  } catch {
    list.innerHTML = `<p class="settings-hint">Support tickets unavailable.</p>`;
  }
}

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

let buyersPageAbort = null;
let settingsTabAbort = null;

function abortSettingsTabListeners() {
  settingsTabAbort?.abort();
  settingsTabAbort = null;
}

export function closeBuyerSettings() {
  const overlay = document.getElementById("settingsOverlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
}

function openSettingsFromQuery() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("settings") !== "1") return;

  params.delete("settings");
  const qs = params.toString();
  const file = window.location.pathname.split("/").pop() || "buyers.html";
  history.replaceState(history.state, "", `${file}${qs ? `?${qs}` : ""}${window.location.hash}`);

  switchTab("profile");
  const overlay = document.getElementById("settingsOverlay");
  if (!overlay) return;
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
}

function bindBuyersPageEvents() {
  buyersPageAbort?.abort();
  buyersPageAbort = new AbortController();
  const { signal } = buyersPageAbort;

  const searchBar = document.getElementById("searchBar");
  if (searchBar) {
    let debounce;
    searchBar.addEventListener("input", (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        searchTerm = e.target.value.toLowerCase().trim();
        renderShoppers();
      }, 200);
    }, { signal });
  }

  document.getElementById("sortSelect")?.addEventListener("change", (e) => {
    sortBy = e.target.value;
    renderShoppers();
  }, { signal });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const overlay = document.getElementById("settingsOverlay");
      if (overlay?.classList.contains("open")) {
        overlay.classList.remove("open");
        overlay.setAttribute("aria-hidden", "true");
      }
    }
  }, { signal });
}

export async function mountBuyersPage() {
  bindBuyersPageEvents();
  if (new URLSearchParams(window.location.search).get("settings") !== "1") {
    closeBuyerSettings();
  }
  await initAuth();
}

document.addEventListener("DOMContentLoaded", () => {
  import("./buyer-router.js").then((r) => {
    if (r.shouldAutoMountPage()) mountBuyersPage();
  });
});
