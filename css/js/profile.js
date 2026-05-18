/* =============================================================
   BuyForMe — Shopper Profile JS
   ============================================================= */

import { supabase } from "./supabase.js";

let shopperUid = null;

/* ─── INIT ─── */
async function initProfile() {
  const uid = new URLSearchParams(window.location.search).get("id");
  if (!uid) { renderNotFound(); return; }

  shopperUid = uid;

  const { data: shopper, error } = await supabase
    .from("public_shoppers").select("*")
    .eq("uid", uid).maybeSingle();

  if (error || !shopper) { renderNotFound(); return; }

  await renderProfile(shopper);
}

/* ─── RENDER ─── */
async function renderProfile(shopper) {
  document.title = `${shopper.name} — BuyForMe`;

  const colors = [
    "linear-gradient(135deg,#1a9e6e 0%,#127a54 100%)",
    "linear-gradient(135deg,#8b5cf6 0%,#6d28d9 100%)",
    "linear-gradient(135deg,#f59e0b 0%,#b45309 100%)",
    "linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%)",
    "linear-gradient(135deg,#f87171 0%,#b91c1c 100%)",
    "linear-gradient(135deg,#14b8a6 0%,#0f766e 100%)"
  ];
  const bannerColor = colors[(shopper.name || "A").charCodeAt(0) % colors.length];
  document.getElementById("profileBanner").style.background = bannerColor;

  const avatarEl = document.getElementById("profileAvatar");
  if (shopper.avatar_url) {
    avatarEl.innerHTML = `<img src="${shopper.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    avatarEl.textContent      = (shopper.name || "S")[0].toUpperCase();
    avatarEl.style.background = bannerColor.match(/#[a-f0-9]{6}/gi)?.[1] || "#1a9e6e";
  }

  document.getElementById("profileName").innerHTML     = `${shopper.name} <span class="verified-badge">✓ Verified</span>`;
  document.getElementById("profileLocation").innerHTML = `<i class="fas fa-map-marker-alt"></i> ${shopper.location || "Location not set"}`;
  document.getElementById("statRating").textContent    = shopper.rating         || "New";
  document.getElementById("statReviews").textContent   = shopper.review_count   || "0";
  document.getElementById("statOrders").textContent    = shopper.completion_rate || "0";
  document.getElementById("statYears").textContent     = shopper.years_active   || "—";
  document.getElementById("profileAbout").textContent  = shopper.about          || `${shopper.name} hasn't added a bio yet.`;

  // Tags
  const tags = shopper.tags
    ? (typeof shopper.tags === "string" ? shopper.tags.split(",") : shopper.tags) : [];
  document.getElementById("profileTags").innerHTML = tags.length > 0
    ? tags.map(t => `<span class="tag">${t.trim()}</span>`).join("")
    : `<span style="color:#5a7268;font-size:0.85rem">No services listed yet.</span>`;

  // Trips
  const trips = shopper.trips
    ? (typeof shopper.trips === "string" ? JSON.parse(shopper.trips) : shopper.trips) : [];
  document.getElementById("profileTrips").innerHTML = trips.length > 0
    ? trips.map(t => `
        <div class="trip-item">
          <div class="trip-icon"><i class="${t.icon || "fas fa-map-marker-alt"}"></i></div>
          <div><div class="trip-name">${t.name}</div><div class="trip-sub">${t.sub}</div></div>
        </div>`).join("")
    : `<p style="color:#5a7268;font-size:0.85rem">No trips added yet.</p>`;

  // Reviews
  const { data: reviews } = await supabase
    .from("reviews").select("*").eq("shopper_id", shopper.uid)
    .order("created_at", { ascending: false });

  document.getElementById("reviewCount").textContent = `(${reviews?.length || 0})`;
  document.getElementById("profileReviews").innerHTML = !reviews || reviews.length === 0
    ? `<div style="color:#5a7268;font-size:0.88rem">No reviews yet — be the first!</div>`
    : reviews.map(r => `
        <div class="review-card">
          <div class="review-header">
            <span class="review-name">${r.buyer_name}</span>
            <span class="review-stars">${renderStars(r.stars)}</span>
          </div>
          <p class="review-text">"${r.text}"</p>
          <p class="review-date">${new Date(r.created_at).toLocaleDateString()}</p>
        </div>`).join("");

  // Sidebar
  document.getElementById("profileFee").textContent        = shopper.fee             || "—";
  document.getElementById("sidebarResponse").textContent   = shopper.response_time   || "—";
  document.getElementById("sidebarCompletion").textContent = shopper.completion_rate  || "—";
  document.getElementById("sidebarSince").textContent      = shopper.joined_at
    ? new Date(shopper.joined_at).getFullYear() : "—";
  document.getElementById("trustPhone").innerHTML = shopper.phone
    ? `<i class="fas fa-phone"></i> Phone number verified` : "";
}

/* ─── BUTTON HANDLERS ───
   Both read shopperUid from the module-level variable.
   No dataset needed — avoids the null error entirely.
─────────────────────────────────────────────────────── */
window.handleRequest = function () {
  if (!shopperUid) return;
  window.location.href = `request.html?id=${shopperUid}`;
};

window.handleMessage = function () {
  if (!shopperUid) return;
  // Opens the full-page chat, pre-loading this shopper's conversation
  const name = document.getElementById("profileName")?.textContent?.trim() || "Shopper";
  window.location.href = `chat.html?with=${shopperUid}&name=${encodeURIComponent(name)}`;
};

/* ─── HELPERS ─── */
function renderStars(count) {
  let html = "";
  for (let i = 1; i <= 5; i++) {
    html += i <= count ? `<i class="fas fa-star"></i>` : `<i class="far fa-star" style="opacity:0.3"></i>`;
  }
  return html;
}

function renderNotFound() {
  const banner    = document.querySelector(".profile-banner");
  const container = document.querySelector(".page-container");
  if (banner)    banner.style.display = "none";
  if (container) container.innerHTML  = `
    <div class="not-found">
      <div style="font-size:3rem;margin-bottom:16px">🔍</div>
      <h2>Shopper not found</h2>
      <p>This profile doesn't exist or may have been removed.</p>
      <a href="buyers.html">Browse all shoppers</a>
    </div>`;
}

document.addEventListener("DOMContentLoaded", initProfile);