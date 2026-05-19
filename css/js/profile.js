/* =============================================================
   BuyForMe — Shopper Profile JS (buyer views a shopper)
   ============================================================= */

import { supabase } from "./supabase.js";
import { requireBuyerSession, fetchPublicShopper } from "./buyer-session.js";

let shopperUid = null;

async function initProfile() {
  try {
    await requireBuyerSession();

    const uid = new URLSearchParams(window.location.search).get("id");
    if (!uid) {
      renderNotFound();
      return;
    }

    shopperUid = uid;
    const shopper = await fetchPublicShopper(uid);
    if (!shopper) {
      renderNotFound();
      return;
    }

    await renderProfile(shopper);
  } catch (err) {
    console.error("Profile page init error:", err);
    renderPageError(err.message || "Failed to load this profile.");
  }
}

async function renderProfile(shopper) {
  document.title = `${shopper.name} — BuyForMe`;

  const colors = [
    "linear-gradient(135deg,#1a9e6e 0%,#127a54 100%)",
    "linear-gradient(135deg,#8b5cf6 0%,#6d28d9 100%)",
    "linear-gradient(135deg,#f59e0b 0%,#b45309 100%)",
    "linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%)",
    "linear-gradient(135deg,#f87171 0%,#b91c1c 100%)",
    "linear-gradient(135deg,#14b8a6 0%,#0f766e 100%)",
  ];
  const bannerColor = colors[(shopper.name || "A").charCodeAt(0) % colors.length];
  document.getElementById("profileBanner").style.background = bannerColor;

  const avatarEl = document.getElementById("profileAvatar");
  if (shopper.avatar_url) {
    avatarEl.innerHTML =
      `<img src="${escapeHtml(shopper.avatar_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    avatarEl.textContent = (shopper.name || "S")[0].toUpperCase();
    avatarEl.style.background = bannerColor.match(/#[a-f0-9]{6}/gi)?.[1] || "#1a9e6e";
  }

  document.getElementById("profileName").innerHTML =
    `${escapeHtml(shopper.name)} <span class="verified-badge"><i class="fas fa-circle-check"></i> Verified</span>`;
  document.getElementById("profileLocation").innerHTML =
    `<i class="fas fa-map-marker-alt"></i> ${escapeHtml(shopper.location || "Location not set")}`;
  document.getElementById("statRating").textContent = shopper.rating ?? "New";
  document.getElementById("statReviews").textContent = shopper.review_count ?? "0";
  document.getElementById("statOrders").textContent = shopper.completion_rate ?? "0";
  document.getElementById("statYears").textContent = shopper.years_active ?? "—";
  document.getElementById("profileAbout").textContent =
    shopper.about || `${shopper.name} hasn't added a bio yet.`;

  renderProfileVideos(shopper.profile_videos);

  const tags = parseTags(shopper.tags);
  document.getElementById("profileTags").innerHTML = tags.length > 0
    ? tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")
    : `<span style="color:#5a7268;font-size:0.85rem">No services listed yet.</span>`;

  const trips = parseTrips(shopper.trips);
  document.getElementById("profileTrips").innerHTML = trips.length > 0
    ? trips.map(t => `
        <div class="trip-item">
          <div class="trip-icon"><i class="${escapeHtml(t.icon || "fas fa-map-marker-alt")}"></i></div>
          <div><div class="trip-name">${escapeHtml(t.name || "")}</div><div class="trip-sub">${escapeHtml(t.sub || "")}</div></div>
        </div>`).join("")
    : `<p style="color:#5a7268;font-size:0.85rem">No trips added yet.</p>`;

  const { data: reviews, error: reviewsError } = await supabase
    .from("reviews")
    .select("*")
    .eq("shopper_id", shopper.uid)
    .order("created_at", { ascending: false });

  if (reviewsError) {
    console.warn("Reviews load failed:", reviewsError);
  }

  document.getElementById("reviewCount").textContent = `(${reviews?.length || 0})`;
  document.getElementById("profileReviews").innerHTML = !reviews || reviews.length === 0
    ? `<div style="color:#5a7268;font-size:0.88rem">No reviews yet — be the first!</div>`
    : reviews.map(r => `
        <div class="review-card">
          <div class="review-header">
            <span class="review-name">${escapeHtml(r.buyer_name)}</span>
            <span class="review-stars">${renderStars(r.stars)}</span>
          </div>
          <p class="review-text">"${escapeHtml(r.text)}"</p>
          <p class="review-date">${new Date(r.created_at).toLocaleDateString()}</p>
        </div>`).join("");

  document.getElementById("profileFee").textContent = shopper.fee || "—";
  document.getElementById("sidebarResponse").textContent = shopper.response_time || "—";
  document.getElementById("sidebarCompletion").textContent = shopper.completion_rate || "—";
  document.getElementById("sidebarSince").textContent = shopper.joined_at
    ? new Date(shopper.joined_at).getFullYear()
    : "—";
  document.getElementById("trustPhone").innerHTML = shopper.phone
    ? `<i class="fas fa-phone"></i> Phone number verified`
    : "";
}

window.handleRequest = function () {
  if (!shopperUid) return;
  window.location.assign(`request.html?id=${encodeURIComponent(shopperUid)}`);
};

window.handleMessage = function () {
  if (!shopperUid) return;
  const nameEl = document.getElementById("profileName");
  const name = nameEl?.textContent?.replace(/\s*Verified.*/i, "").trim() || "Shopper";
  window.location.assign(
    `chat.html?with=${encodeURIComponent(shopperUid)}&name=${encodeURIComponent(name)}`
  );
};

function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return String(raw).split(",").map(t => t.trim()).filter(Boolean);
}

function parseTrips(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
}

function parseProfileVideos(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function renderProfileVideos(raw) {
  const card = document.getElementById("profileVideosCard");
  const grid = document.getElementById("profileVideos");
  if (!card || !grid) return;

  const videos = parseProfileVideos(raw).filter(v => v && v.url);
  if (videos.length === 0) {
    card.style.display = "none";
    return;
  }

  card.style.display = "block";
  grid.innerHTML = videos.map(v => `
    <div class="profile-video-item">
      <video controls playsinline preload="metadata" src="${escapeHtml(v.url)}"></video>
      ${v.title ? `<p class="profile-video-caption">${escapeHtml(v.title)}</p>` : ""}
    </div>`).join("");
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderStars(count) {
  const n = Number(count) || 0;
  let html = "";
  for (let i = 1; i <= 5; i++) {
    html += i <= n
      ? `<i class="fas fa-star"></i>`
      : `<i class="far fa-star" style="opacity:0.3"></i>`;
  }
  return html;
}

function renderPageError(message) {
  const banner = document.querySelector(".profile-banner");
  const container = document.querySelector(".page-container");
  if (banner) banner.style.display = "none";
  if (!container) return;
  container.innerHTML = `
    <div class="profile-error-state">
      <div class="profile-error-icon"><i class="fas fa-circle-exclamation"></i></div>
      <h2>Something went wrong</h2>
      <p>${escapeHtml(message)}</p>
      <a href="buyers.html" class="profile-error-back"><i class="fas fa-arrow-left"></i> Back to shoppers</a>
    </div>`;
}

function renderNotFound() {
  const banner = document.querySelector(".profile-banner");
  const container = document.querySelector(".page-container");
  if (banner) banner.style.display = "none";
  if (container) {
    container.innerHTML = `
    <div class="not-found">
      <div class="not-found-icon"><i class="fas fa-user-slash"></i></div>
      <h2>Shopper not found</h2>
      <p>This profile doesn't exist or the shopper isn't approved yet.</p>
      <a href="buyers.html"><i class="fas fa-arrow-left"></i> Browse all shoppers</a>
    </div>`;
  }
}

document.addEventListener("DOMContentLoaded", initProfile);
