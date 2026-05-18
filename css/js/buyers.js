/* =============================================================
   BuyForMe — buyers.js
   ============================================================= */

import { supabase } from "./supabase.js";


/* ─────────────────────────────────────────────
   1. STATE
───────────────────────────────────────────── */
let currentUser  = { id: "", name: "Buyer", email: "", role: "buyer" };
let allShoppers  = [];

const filters    = ["All", "Turkey", "China", "UK", "USA", "Fashion", "Electronics", "Furniture"];
let activeFilter = "All";
let searchTerm   = "";


/* ─────────────────────────────────────────────
   2. AUTH CHECK + LOAD REAL USER
───────────────────────────────────────────── */
async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = "auth.html";
    return;
  }

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("uid", session.user.id)
    .maybeSingle();

  if (!profile) {
    window.location.href = "auth.html";
    return;
  }

  if (profile.role === "shopper") {
    window.location.href = "verify.html";
    return;
  }

  currentUser = {
    id:       profile.uid,
    name:     profile.name     || "Buyer",
    email:    profile.email    || "",
    role:     profile.role     || "buyer",
    address:  profile.address  || "",
    city:     profile.city     || "",
    country:  profile.country  || "",
    currency: profile.currency || "",
    payment:  profile.payment  || ""
  };

  updateNavUser();
  renderFilters();
  await loadShoppers();
  prefillProfile();
}


/* ─────────────────────────────────────────────
   3. LOAD REAL SHOPPERS FROM SUPABASE
───────────────────────────────────────────── */
async function loadShoppers() {
  const { data, error } = await supabase
    .from("public_shoppers")
    .select("*")
    ;

  if (error) {
    console.error("Failed to load shoppers:", error);
    return;
  }

  allShoppers = data;
  renderShoppers();
}


/* ─────────────────────────────────────────────
   4. UPDATE NAV
───────────────────────────────────────────── */
function updateNavUser() {
  const avatar     = document.getElementById("userAvatar");
  const welcomeMsg = document.getElementById("welcomeMsg");
  if (avatar)     avatar.textContent     = currentUser.name[0].toUpperCase();
  if (welcomeMsg) welcomeMsg.textContent = `Welcome back, ${currentUser.name}! 👋`;
}


/* ─────────────────────────────────────────────
   5. PRE-FILL PROFILE
───────────────────────────────────────────── */
function prefillProfile() {
  const nameInput  = document.getElementById("settingName");
  const emailInput = document.getElementById("settingEmail");
  if (nameInput)  nameInput.value  = currentUser.name;
  if (emailInput) emailInput.value = currentUser.email;
}


/* ─────────────────────────────────────────────
   6. RENDER FILTER PILLS
───────────────────────────────────────────── */
function renderFilters() {
  const filterPills = document.getElementById("filterPills");
  if (!filterPills) return;

  filterPills.innerHTML = filters.map(f => `
    <button class="filter-pill ${f === activeFilter ? "active" : ""}"
      onclick="setFilter('${f}')">${f}</button>
  `).join("");
}


/* ─────────────────────────────────────────────
   7. RENDER SHOPPER CARDS
   Layout: colored header banner + avatar initial,
   name + verified badge, location, stats row
   (Rating / Reviews / Orders), specialty tags,
   View Profile & Request button.
───────────────────────────────────────────── */
function renderShoppers() {
  const headerColors = [
    "#1a9e6e", // teal green
    "#7c3aed", // purple
    "#d97706", // amber
    "#059669", // emerald
    "#dc2626", // coral red
    "#2563eb", // blue
    "#0891b2", // cyan
    "#9333ea", // violet
  ];

  const visible = allShoppers.filter(s => {
    const location = (s.location || "").toLowerCase();
    const name     = (s.name     || "").toLowerCase();
    const about    = (s.about    || "").toLowerCase();
    const tags     = (s.tags     || "").toLowerCase();

    const matchFilter =
      activeFilter === "All" ||
      location.includes(activeFilter.toLowerCase()) ||
      tags.includes(activeFilter.toLowerCase());

    const matchSearch =
      !searchTerm ||
      name.includes(searchTerm)     ||
      location.includes(searchTerm) ||
      about.includes(searchTerm)    ||
      tags.includes(searchTerm);

    return matchFilter && matchSearch;
  });

  const resultCount = document.getElementById("resultCount");
  if (resultCount) {
    resultCount.textContent = `${visible.length} shopper${visible.length !== 1 ? "s" : ""}`;
  }

  const grid = document.getElementById("shopperGrid");
  if (!grid) return;

  if (visible.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div style="font-size:2rem">🔍</div>
        <p>No shoppers found. Try a different search or filter.</p>
      </div>`;
    return;
  }

  grid.innerHTML = visible.map((s, index) => {
    const headerColor = headerColors[index % headerColors.length];
    const initial     = (s.name || "S")[0].toUpperCase();

    // Avatar — photo if available, else colored initial circle
    const avatarInner = s.avatar_url
      ? `<img src="${s.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : initial;

    const location = s.location || "Unknown location";

    // Stats — use real fields with fallbacks
    const rating  = s.rating           || "New";
    const reviews = s.review_count     || "0";
    const orders  = s.completion_rate  ? s.completion_rate + "+" : "0+";

    // Tags — stored as comma-separated string e.g. "Zara Istanbul, Grand Bazaar, Trendyol"
    const tagList = s.tags
      ? s.tags.split(",").map(t => t.trim()).filter(Boolean).slice(0, 3)
      : [];

    const tagsHTML = tagList.length > 0
      ? `<div class="shopper-tags">
          ${tagList.map(t => `<span class="shopper-tag">${t}</span>`).join("")}
         </div>`
      : "";

    return `
      <div class="shopper-card">

        <!-- Colored banner header -->
        <div class="card-banner" style="background:${headerColor};">
          <div class="card-avatar">${avatarInner}</div>
        </div>

        <!-- Card body -->
        <div class="card-body">

          <!-- Name + verified -->
          <div class="card-name-row">
            <h3 class="card-name">${s.name || "Shopper"}</h3>
            <span class="verified-badge">✓ Verified</span>
          </div>

          <!-- Location -->
          <p class="card-location">📍 ${location}</p>

          <!-- Stats: Rating | Reviews | Orders -->
          <div class="card-stats">
            <div class="card-stat">
              <strong>${rating}</strong>
              <span>Rating</span>
            </div>
            <div class="card-stat-divider"></div>
            <div class="card-stat">
              <strong>${reviews}</strong>
              <span>Reviews</span>
            </div>
            <div class="card-stat-divider"></div>
            <div class="card-stat">
              <strong>${orders}</strong>
              <span>Orders</span>
            </div>
          </div>

          <!-- Specialty tags -->
          ${tagsHTML}

          <!-- CTA button -->
          <button class="btn-view-profile" onclick="goToProfile('${s.uid}')">
            View Profile &amp; Request
          </button>

        </div>
      </div>
    `;
  }).join("");
}


/* ─────────────────────────────────────────────
   8. FILTER + SEARCH + PROFILE
───────────────────────────────────────────── */
window.setFilter = function(f) {
  activeFilter = f;
  renderFilters();
  renderShoppers();
};

window.goToProfile = function(uid) {
  window.location.href = `shopper-profile.html?id=${uid}`;
};


/* ─────────────────────────────────────────────
   9. SETTINGS PANEL
───────────────────────────────────────────── */
window.toggleSettings = function() {
  document.getElementById("settingsOverlay").classList.toggle("open");
};

window.closeSettings = function(e) {
  if (e.target === document.getElementById("settingsOverlay")) {
    document.getElementById("settingsOverlay").classList.remove("open");
  }
};


/* ─────────────────────────────────────────────
   10. SETTINGS TABS
───────────────────────────────────────────── */
window.switchTab = function(tab) {
  document.querySelectorAll(".s-nav-btn").forEach(b => b.classList.remove("active"));
  const activeBtn = [...document.querySelectorAll(".s-nav-btn")]
    .find(b => b.getAttribute("onclick")?.includes(tab));
  if (activeBtn) activeBtn.classList.add("active");

  const form = document.getElementById("settingsForm");
  if (!form) return;

  if (tab === "profile") {
    form.innerHTML = `
      <label>Full Name</label>
      <input type="text" id="settingName" value="${currentUser.name}" placeholder="Enter your name">
      <label>Email Address</label>
      <input type="email" id="settingEmail" value="${currentUser.email}" placeholder="Enter your email">
      <button class="btn-save" onclick="saveProfile()">Save Changes</button>
      <div id="profileMsg" style="margin-top:12px;font-size:0.85rem;"></div>
    `;
  } else if (tab === "shipping") {
    form.innerHTML = `
      <label>Street Address</label>
      <input type="text" id="settingAddress" value="${currentUser.address}" placeholder="e.g. 12 Accra Road">
      <label>City</label>
      <input type="text" id="settingCity" value="${currentUser.city}" placeholder="e.g. Lagos">
      <label>Country</label>
      <input type="text" id="settingCountry" value="${currentUser.country}" placeholder="e.g. Nigeria">
      <button class="btn-save" onclick="saveShipping()">Save Address</button>
      <div id="shippingMsg" style="margin-top:12px;font-size:0.85rem;"></div>
    `;
  } else if (tab === "payments") {
    form.innerHTML = `
      <label>Preferred Currency</label>
      <input type="text" id="settingCurrency" value="${currentUser.currency}" placeholder="e.g. USD, NGN, GHS">
      <label>Mobile Money / Bank</label>
      <input type="text" id="settingPayment" value="${currentUser.payment}" placeholder="e.g. MTN MoMo, Opay">
      <button class="btn-save" onclick="savePayments()">Save Payment Info</button>
      <div id="paymentsMsg" style="margin-top:12px;font-size:0.85rem;"></div>
    `;
  }
};


/* ─────────────────────────────────────────────
   11. SAVE TO SUPABASE
───────────────────────────────────────────── */
window.saveProfile = async function() {
  const name  = document.getElementById("settingName")?.value.trim();
  const email = document.getElementById("settingEmail")?.value.trim();
  const msg   = document.getElementById("profileMsg");

  if (!name || !email) {
    msg.style.color = "#ef4444";
    msg.textContent = "Please fill in all fields.";
    return;
  }

  msg.style.color = "#5a7268";
  msg.textContent = "Saving...";

  const { error } = await supabase
    .from("users")
    .update({ name, email })
    .eq("uid", currentUser.id);

  if (error) {
    msg.style.color = "#ef4444";
    msg.textContent = "Failed to save. Please try again.";
    return;
  }

  currentUser.name  = name;
  currentUser.email = email;
  updateNavUser();

  msg.style.color = "#1a9e6e";
  msg.textContent = "✅ Profile updated successfully!";
};

window.saveShipping = async function() {
  const address = document.getElementById("settingAddress")?.value.trim();
  const city    = document.getElementById("settingCity")?.value.trim();
  const country = document.getElementById("settingCountry")?.value.trim();
  const msg     = document.getElementById("shippingMsg");

  msg.style.color = "#5a7268";
  msg.textContent = "Saving...";

  const { error } = await supabase
    .from("users")
    .update({ address, city, country })
    .eq("uid", currentUser.id);

  if (error) {
    msg.style.color = "#ef4444";
    msg.textContent = "Failed to save. Please try again.";
    return;
  }

  currentUser.address = address;
  currentUser.city    = city;
  currentUser.country = country;

  msg.style.color = "#1a9e6e";
  msg.textContent = "✅ Address saved successfully!";
};

window.savePayments = async function() {
  const currency = document.getElementById("settingCurrency")?.value.trim();
  const payment  = document.getElementById("settingPayment")?.value.trim();
  const msg      = document.getElementById("paymentsMsg");

  msg.style.color = "#5a7268";
  msg.textContent = "Saving...";

  const { error } = await supabase
    .from("users")
    .update({ currency, payment })
    .eq("uid", currentUser.id);

  if (error) {
    msg.style.color = "#ef4444";
    msg.textContent = "Failed to save. Please try again.";
    return;
  }

  currentUser.currency = currency;
  currentUser.payment  = payment;

  msg.style.color = "#1a9e6e";
  msg.textContent = "✅ Payment info saved successfully!";
};


/* ─────────────────────────────────────────────
   12. LOGOUT
───────────────────────────────────────────── */
window.handleLogout = async function() {
  await supabase.auth.signOut();
  window.location.href = "auth.html";
};


/* ─────────────────────────────────────────────
   13. INIT
───────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  initAuth();

  const searchBar = document.getElementById("searchBar");
  if (searchBar) {
    searchBar.addEventListener("input", e => {
      searchTerm = e.target.value.toLowerCase().trim();
      renderShoppers();
    });
  }
});