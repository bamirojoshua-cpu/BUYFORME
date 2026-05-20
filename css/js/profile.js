/* =============================================================
   BuyForMe — Shopper Profile JS (buyer views a shopper)
   ============================================================= */

import { supabase } from "./supabase.js";
import { requireBuyerSession, fetchPublicShopper } from "./buyer-session.js";
import { initBuyerShell } from "./buyer-shell.js";
import { nameWithVerifiedBadge, plainNameFromElement } from "./verified-badge.js";
import { applyProfileCover, flagEmoji } from "./country-flag.js";

let shopperUid = null;
let cachedReviews = [];

async function initProfile() {
  try {
    const authed = await requireBuyerSession();
    if (!authed) return;
    await initBuyerShell("profile", {
      title: "Shopper profile",
      skipAuth: true,
      user: authed.profile,
    });

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

    setupProfileTabs();
    await renderProfile(shopper);
  } catch (err) {
    console.error("Profile page init error:", err);
    renderPageError(err.message || "Failed to load this profile.");
  }
}

const PROFILE_TAB_MS = 260;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setupProfileTabs() {
  const tabs = document.querySelectorAll(".profile-tab");
  const panels = document.querySelectorAll(".profile-tab-panel");
  let switching = false;

  panels.forEach((p) => {
    const isOverview = p.id === "panel-overview";
    p.classList.toggle("active", isOverview);
    p.setAttribute("aria-hidden", isOverview ? "false" : "true");
    p.hidden = false;
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const id = tab.dataset.tab;
      if (tab.hidden || switching) return;

      const incoming = document.getElementById(`panel-${id}`);
      const outgoing = document.querySelector(".profile-tab-panel.active");
      if (!incoming || incoming === outgoing) return;

      switching = true;

      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });

      const finish = () => {
        outgoing?.classList.remove("active", "is-leaving");
        outgoing?.setAttribute("aria-hidden", "true");

        incoming.classList.add("active", "is-entering");
        incoming.setAttribute("aria-hidden", "false");

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            incoming.classList.remove("is-entering");
            switching = false;
          });
        });
      };

      if (prefersReducedMotion()) {
        finish();
        return;
      }

      outgoing?.classList.add("is-leaving");
      setTimeout(finish, PROFILE_TAB_MS);
    });
  });
}

async function renderProfile(shopper) {
  document.title = `${shopper.name} — BuyForMe`;

  const cover = document.getElementById("profileCover");
  const { code, accent } = applyProfileCover(cover, shopper.location);

  const avatarEl = document.getElementById("profileAvatar");
  if (shopper.avatar_url) {
    avatarEl.innerHTML = `<img src="${escapeHtml(shopper.avatar_url)}" alt="">`;
    avatarEl.style.background = "";
  } else {
    avatarEl.textContent = (shopper.name || "S")[0].toUpperCase();
    avatarEl.style.background = accent;
  }

  const nameEl = document.getElementById("profileName");
  nameEl.innerHTML = nameWithVerifiedBadge(shopper.name || "Shopper", {
    tag: "span",
    className: "profile-name-verified",
    size: 26,
  });

  const locText = shopper.location || "Location not set";
  const flag = code ? flagEmoji(code) : "";
  document.getElementById("profileLocation").innerHTML = flag
    ? `<span class="profile-location__flag" aria-hidden="true">${flag}</span><span>${escapeHtml(locText)}</span>`
    : `<i class="fas fa-location-dot" aria-hidden="true"></i><span>${escapeHtml(locText)}</span>`;

  renderTrustStrip(shopper);

  const fee = shopper.fee || "—";
  document.getElementById("profileFee").textContent = fee;
  const feeHero = document.getElementById("profileFeeHero");
  if (feeHero) feeHero.textContent = fee;

  const rating = shopper.rating ?? "New";
  document.getElementById("statRating").textContent =
    rating === "New" ? "New" : String(rating);
  document.getElementById("statReviews").textContent = shopper.review_count ?? "0";
  document.getElementById("statCompletion").textContent = formatCompletion(shopper.completion_rate);
  document.getElementById("statYears").textContent = shopper.years_active
    ? `${shopper.years_active} yr${shopper.years_active === 1 ? "" : "s"}`
    : "—";

  renderAbout(shopper);
  renderTags(shopper);
  renderTrips(shopper);

  const videos = parseProfileVideos(shopper.profile_videos).filter((v) => v && v.url);
  setupVideosTab(videos);
  renderProfileVideos(videos);

  const { data: reviews, error: reviewsError } = await supabase
    .from("reviews")
    .select("*")
    .eq("shopper_id", shopper.uid)
    .order("created_at", { ascending: false });

  if (reviewsError) console.warn("Reviews load failed:", reviewsError);
  cachedReviews = reviews || [];

  const count = cachedReviews.length;
  const tabCount = document.getElementById("reviewTabCount");
  if (tabCount) tabCount.textContent = count ? `(${count})` : "";

  renderReviewSummary(cachedReviews, rating);
  renderReviewsList(cachedReviews);

  document.getElementById("sidebarResponse").textContent = shopper.response_time || "—";
  document.getElementById("sidebarCompletion").textContent = formatCompletion(shopper.completion_rate);
  document.getElementById("sidebarSince").textContent = shopper.joined_at
    ? new Date(shopper.joined_at).getFullYear()
    : "—";

  renderTrustBadges(shopper);
}

function formatCompletion(val) {
  if (val == null || val === "") return "—";
  const s = String(val);
  return s.includes("%") ? s : `${s}%`;
}

function renderTrustStrip(shopper) {
  const el = document.getElementById("profileTrustStrip");
  if (!el) return;

  const parts = [
    `<span class="trust-strip-item trust-strip-item--verified"><i class="fas fa-circle-check"></i> Verified shopper</span>`,
  ];
  if (shopper.response_time) {
    parts.push(
      `<span class="trust-strip-item"><i class="fas fa-clock"></i> ${escapeHtml(shopper.response_time)}</span>`
    );
  }
  if (shopper.fee) {
    parts.push(
      `<span class="trust-strip-item"><i class="fas fa-percent"></i> Fee ${escapeHtml(shopper.fee)}</span>`
    );
  }
  el.innerHTML = parts.join("");
}

function renderTrustBadges(shopper) {
  const el = document.getElementById("profileTrustBadges");
  if (!el) return;

  const pills = [`<span class="trust-pill"><i class="fas fa-shield-halved"></i> Identity verified</span>`];
  if (shopper.phone) {
    pills.push(`<span class="trust-pill"><i class="fas fa-phone"></i> Phone verified</span>`);
  }
  el.innerHTML = pills.join("");
}

function renderAbout(shopper) {
  const el = document.getElementById("profileAbout");
  if (!el) return;

  const text = shopper.about || `${shopper.name} hasn't added a bio yet.`;
  el.textContent = text;

  if (text.length > 280) {
    el.classList.add("is-clamped");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-read-more";
    btn.textContent = "Read more";
    btn.addEventListener("click", () => {
      el.classList.remove("is-clamped");
      btn.remove();
    });
    el.after(btn);
  }
}

function renderTags(shopper) {
  const tags = parseTags(shopper.tags);
  const el = document.getElementById("profileTags");
  el.innerHTML =
    tags.length > 0
      ? tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")
      : `<span class="tags-empty">No specialties listed yet.</span>`;
}

function renderTrips(shopper) {
  const trips = parseTrips(shopper.trips);
  const el = document.getElementById("profileTrips");
  el.innerHTML =
    trips.length > 0
      ? trips
          .slice(0, 6)
          .map(
            (t) => `
        <div class="trip-item">
          <div class="trip-icon"><i class="${escapeHtml(t.icon || "fas fa-map-marker-alt")}"></i></div>
          <div>
            <div class="trip-name">${escapeHtml(t.name || "")}</div>
            <div class="trip-sub">${escapeHtml(t.sub || "")}</div>
          </div>
        </div>`
          )
          .join("")
      : `<p class="trips-empty">No recent trips listed yet.</p>`;
}

function setupVideosTab(videos) {
  const tab = document.getElementById("tab-videos");
  if (!tab) return;
  if (videos.length > 0) {
    tab.hidden = false;
    tab.removeAttribute("hidden");
  } else {
    tab.hidden = true;
    tab.setAttribute("hidden", "");
  }
}

function renderProfileVideos(videos) {
  const grid = document.getElementById("profileVideos");
  if (!grid) return;

  if (!videos.length) {
    grid.innerHTML = `<p class="trips-empty">No videos yet.</p>`;
    return;
  }

  grid.innerHTML = videos
    .map(
      (v) => `
    <div class="profile-video-item">
      <video controls playsinline preload="metadata" src="${escapeHtml(v.url)}"></video>
      ${v.title ? `<p class="profile-video-caption">${escapeHtml(v.title)}</p>` : ""}
    </div>`
    )
    .join("");
}

function renderReviewSummary(reviews, ratingLabel) {
  const el = document.getElementById("reviewsSummary");
  if (!el) return;

  if (!reviews.length) {
    el.innerHTML = "";
    el.style.display = "none";
    return;
  }

  el.style.display = "";

  const avg =
    reviews.reduce((s, r) => s + (Number(r.stars) || 0), 0) / reviews.length;
  const displayRating = ratingLabel !== "New" ? ratingLabel : avg.toFixed(1);

  const dist = [0, 0, 0, 0, 0];
  reviews.forEach((r) => {
    const s = Math.min(5, Math.max(1, Math.round(Number(r.stars) || 0)));
    dist[s - 1]++;
  });
  const max = Math.max(...dist, 1);

  el.innerHTML = `
    <div class="reviews-summary__score">
      <strong>${escapeHtml(String(displayRating))}</strong>
      <div class="reviews-summary__stars">${renderStars(Math.round(avg))}</div>
      <span class="reviews-summary__count">${reviews.length} review${reviews.length !== 1 ? "s" : ""}</span>
    </div>
    <div class="reviews-summary__bars">
      ${[5, 4, 3, 2, 1]
        .map(
          (star) => `
        <div class="review-bar-row">
          <span>${star} ★</span>
          <div class="review-bar-track">
            <div class="review-bar-fill" style="width:${(dist[star - 1] / max) * 100}%"></div>
          </div>
        </div>`
        )
        .join("")}
    </div>`;
}

function renderReviewsList(reviews) {
  const el = document.getElementById("profileReviews");
  if (!el) return;

  if (!reviews.length) {
    el.innerHTML = `
      <div class="reviews-empty">
        <i class="fas fa-star"></i>
        No reviews yet — be the first after your order!
      </div>`;
    return;
  }

  el.innerHTML = reviews
    .map((r) => {
      const initial = (r.buyer_name || "B")[0].toUpperCase();
      return `
      <article class="review-card">
        <div class="review-header">
          <div class="review-buyer">
            <span class="review-buyer-avatar">${initial}</span>
            <span class="review-name">${escapeHtml(r.buyer_name)}</span>
          </div>
          <span class="review-stars">${renderStars(r.stars)}</span>
        </div>
        <p class="review-text">"${escapeHtml(r.text)}"</p>
        <p class="review-date">${new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
      </article>`;
    })
    .join("");
}

window.handleRequest = function () {
  if (!shopperUid) return;
  window.location.assign(`request.html?id=${encodeURIComponent(shopperUid)}`);
};

window.handleMessage = function () {
  if (!shopperUid) return;
  const name = plainNameFromElement(document.getElementById("profileName")) || "Shopper";
  window.location.assign(
    `chat.html?with=${encodeURIComponent(shopperUid)}&name=${encodeURIComponent(name)}`
  );
};

function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return String(raw)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
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

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderStars(count) {
  const n = Number(count) || 0;
  let html = "";
  for (let i = 1; i <= 5; i++) {
    html +=
      i <= n
        ? `<i class="fas fa-star"></i>`
        : `<i class="far fa-star" style="opacity:0.35"></i>`;
  }
  return html;
}

function renderPageError(message) {
  const inner = document.querySelector(".profile-page-inner");
  if (inner) {
    inner.innerHTML = `
    <div class="profile-error-state buyer-animate-in">
      <div class="profile-error-icon"><i class="fas fa-circle-exclamation"></i></div>
      <h2>Something went wrong</h2>
      <p>${escapeHtml(message)}</p>
      <a href="buyers.html" class="profile-error-back"><i class="fas fa-arrow-left"></i> Back to shoppers</a>
    </div>`;
  }
}

function renderNotFound() {
  const hero = document.querySelector(".profile-hero");
  if (hero) hero.style.display = "none";
  const inner = document.querySelector(".profile-page-inner");
  if (inner) {
    inner.innerHTML = `
    <div class="not-found buyer-animate-in">
      <div class="not-found-icon"><i class="fas fa-user-slash"></i></div>
      <h2>Shopper not found</h2>
      <p>This profile doesn't exist or the shopper isn't approved yet.</p>
      <a href="buyers.html"><i class="fas fa-arrow-left"></i> Browse shoppers</a>
    </div>`;
  }
}

document.addEventListener("DOMContentLoaded", initProfile);
