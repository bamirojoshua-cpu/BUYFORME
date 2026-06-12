/* BuyForMe — Send purchase request (buyer → shopper) */

import { supabase } from "./supabase.js";
import { requireBuyerSession, fetchPublicShopper } from "./buyer-session.js";
import { nameWithVerifiedBadge } from "./verified-badge.js";
import { initBuyerShell, showBuyerToast } from "./buyer-shell.js";
import { flagEmoji, countryCodeFromLocation } from "./country-flag.js";
import { buildRequestRow, insertRequest, computeFees, PLATFORM_FEE_PERCENT } from "./api/request-builder.js";
import { invalidateOrdersCache } from "./api/orders.js";
import { addToWishlist } from "./api/wishlist.js";
import { addToCart } from "./api/cart.js";

const TOTAL_STEPS = 3;
const DRAFT_PREFIX = "bfm-request-draft-";

let currentUser = null;
let currentShopper = null;
let shopperFeePercent = 10;
let wizardStep = 1;

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function $(id) {
  return document.getElementById(id);
}

function getFormValues() {
  return {
    productName: $("productName")?.value.trim() || "",
    storeName: $("storeName")?.value.trim() || "",
    quantity: $("quantity")?.value || "1",
    category: $("category")?.value || "",
    notes: $("notes")?.value.trim() || "",
    currency: $("currency")?.value || "USD",
    budget: $("budget")?.value || "",
    address: $("address")?.value.trim() || "",
    country: $("country")?.value.trim() || "",
    phone: $("phone")?.value.trim() || "",
    timeline: $("timeline")?.value || "",
  };
}

function draftKey() {
  return currentShopper?.uid ? `${DRAFT_PREFIX}${currentShopper.uid}` : null;
}

function saveDraft() {
  const key = draftKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(getFormValues()));
  } catch {
    /* ignore */
  }
}

function loadDraft() {
  const key = draftKey();
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.productName) $("productName").value = d.productName;
    if (d.storeName) $("storeName").value = d.storeName;
    if (d.quantity) $("quantity").value = d.quantity;
    if (d.category) $("category").value = d.category;
    if (d.notes) $("notes").value = d.notes;
    if (d.currency) $("currency").value = d.currency;
    if (d.budget) $("budget").value = d.budget;
    if (d.address) $("address").value = d.address;
    if (d.country) $("country").value = d.country;
    if (d.phone) $("phone").value = d.phone;
    if (d.timeline) $("timeline").value = d.timeline;
    updateFeeEstimate();
    updateNotesCount();
    showBuyerToast("Restored your saved draft");
  } catch {
    /* ignore */
  }
}

function clearDraft() {
  const key = draftKey();
  if (key) try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function updateProgress() {
  const pct = (wizardStep / TOTAL_STEPS) * 100;
  const bar = $("requestProgressBar");
  if (bar) bar.style.width = `${pct}%`;
}

function setWizardStep(n) {
  wizardStep = Math.min(TOTAL_STEPS, Math.max(1, n));
  document.querySelectorAll(".wizard-step").forEach((el) => {
    const s = Number(el.dataset.step);
    el.classList.toggle("active", s === wizardStep);
    el.classList.toggle("done", s < wizardStep);
    el.setAttribute("aria-current", s === wizardStep ? "step" : "false");
  });
  document.querySelectorAll(".wizard-panel").forEach((panel) => {
    const match = Number(panel.dataset.panel) === wizardStep;
    panel.classList.toggle("active", match);
    panel.hidden = !match;
    panel.setAttribute("aria-hidden", match ? "false" : "true");
  });

  const back = $("wizardBack");
  const next = $("wizardNext");
  const stickyNext = $("stickyNextBtn");
  const stickyBack = $("stickyBackBtn");
  const label = wizardStep === TOTAL_STEPS ? "Send request" : "Continue";
  const icon =
    wizardStep === TOTAL_STEPS
      ? '<i class="fas fa-paper-plane" aria-hidden="true"></i>'
      : '<i class="fas fa-arrow-right" aria-hidden="true"></i>';

  const showBack = wizardStep > 1;
  if (back) back.hidden = !showBack;
  if (stickyBack) stickyBack.hidden = !showBack;
  if (next) next.innerHTML = `${icon} ${label}`;
  if (stickyNext) stickyNext.innerHTML = `${icon} ${label}`;

  updateProgress();
  if (wizardStep === TOTAL_STEPS) renderReviewSummary();
  updateAsideSummary();
}

function validateStep(step) {
  const v = getFormValues();
  if (step === 1) {
    if (!v.productName) {
      showError("Enter what you want the shopper to buy.");
      $("productName")?.focus();
      return false;
    }
    if (!v.quantity || Number(v.quantity) < 1) {
      showError("Enter a valid quantity.");
      $("quantity")?.focus();
      return false;
    }
  }
  if (step === 2) {
    if (!v.address) {
      showError("Enter your delivery address.");
      $("address")?.focus();
      return false;
    }
  }
  if (step === 3) {
    if (!v.budget || Number(v.budget) <= 0) {
      showError("Enter your estimated product budget.");
      $("budget")?.focus();
      return false;
    }
  }
  hideError();
  return true;
}

function goNext() {
  if (!validateStep(wizardStep)) return;
  saveDraft();
  if (wizardStep < TOTAL_STEPS) {
    setWizardStep(wizardStep + 1);
    $("formState")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  handleSubmit();
}

function goBack() {
  hideError();
  if (wizardStep > 1) setWizardStep(wizardStep - 1);
}

function computeFormFees() {
  const budget = parseFloat(getFormValues().budget) || 0;
  const currency = getFormValues().currency;
  const { shopperFee, platformFee, total } = computeFees(budget, shopperFeePercent);
  return { budget, currency, shopperFee, platformFee, total };
}

export function updateFeeEstimate() {
  const { budget, currency, shopperFee, platformFee, total } = computeFormFees();
  const show = budget > 0;

  document.querySelectorAll(".price-breakdown").forEach((box) => {
    box.classList.toggle("is-visible", show);
  });
  $("priceBreakdownAside")?.classList.toggle("is-visible", show);

  if (!show) {
    updateAsideSummary();
    return;
  }

  const fmt = (n) => `${currency} ${n.toFixed(2)}`;
  const set = (id, text) => {
    const el = $(id);
    if (el) el.textContent = text;
  };

  set("breakdownBudget", fmt(budget));
  set("breakdownBudgetAside", fmt(budget));
  set("breakdownFeePercent", `(${shopperFeePercent}%)`);
  set("breakdownFeePercentAside", `(${shopperFeePercent}%)`);
  set("breakdownShopperFee", fmt(shopperFee));
  set("breakdownShopperFeeAside", fmt(shopperFee));
  set("breakdownPlatformFee", fmt(platformFee));
  set("breakdownPlatformFeeAside", fmt(platformFee));
  set("breakdownTotal", fmt(total));
  set("breakdownTotalAside", fmt(total));

  updateAsideSummary();
}

function updateNotesCount() {
  const notes = $("notes");
  const counter = $("notesCount");
  if (!notes || !counter) return;
  const n = notes.value.length;
  counter.textContent = `${n} / 500`;
  const parent = counter.closest(".field-hint");
  if (parent) parent.classList.toggle("is-warn", n > 450);
}

function updateAsideSummary() {
  const el = $("requestSummaryList");
  if (!el) return;
  const v = getFormValues();
  const lines = [];

  if (v.productName) {
    lines.push({ icon: "fa-box", label: "Product", value: v.productName });
  }
  if (v.storeName) {
    lines.push({ icon: "fa-store", label: "Store", value: v.storeName });
  }
  if (v.quantity) {
    lines.push({
      icon: "fa-hashtag",
      label: "Qty",
      value: `${v.quantity}${v.category ? ` · ${v.category}` : ""}`,
    });
  }
  if (v.address) {
    lines.push({ icon: "fa-location-dot", label: "Deliver to", value: v.address });
  }
  if (v.timeline) {
    lines.push({ icon: "fa-clock", label: "Timeline", value: v.timeline });
  }

  if (!lines.length) {
    el.innerHTML = `<p class="request-summary-empty">Fill in the form — your summary updates here.</p>`;
    return;
  }

  el.innerHTML = lines
    .map(
      (row) => `
    <li class="request-summary-row">
      <i class="fas ${row.icon}" aria-hidden="true"></i>
      <div>
        <span class="request-summary-label">${escapeHtml(row.label)}</span>
        <span class="request-summary-value">${escapeHtml(row.value)}</span>
      </div>
    </li>`
    )
    .join("");
}

function renderReviewSummary() {
  const el = $("reviewSummary");
  if (!el) return;
  const v = getFormValues();
  const { currency, total } = computeFormFees();

  el.innerHTML = `
    <dl class="review-dl">
      <div><dt>Product</dt><dd>${escapeHtml(v.productName)}</dd></div>
      ${v.storeName ? `<div><dt>Store</dt><dd>${escapeHtml(v.storeName)}</dd></div>` : ""}
      <div><dt>Quantity</dt><dd>${escapeHtml(v.quantity)}${v.category ? ` · ${escapeHtml(v.category)}` : ""}</dd></div>
      ${v.notes ? `<div class="review-dl--full"><dt>Notes</dt><dd>${escapeHtml(v.notes)}</dd></div>` : ""}
      <div><dt>Delivery</dt><dd>${escapeHtml(v.address)}${v.country ? `, ${escapeHtml(v.country)}` : ""}</dd></div>
      ${v.phone ? `<div><dt>Phone</dt><dd>${escapeHtml(v.phone)}</dd></div>` : ""}
      ${v.timeline ? `<div><dt>Timeline</dt><dd>${escapeHtml(v.timeline)}</dd></div>` : ""}
      <div class="review-dl--highlight"><dt>Estimated total</dt><dd>${escapeHtml(currency)} ${total.toFixed(2)}</dd></div>
    </dl>
    <p class="review-pay-note"><i class="fas fa-lock" aria-hidden="true"></i> You only pay after the shopper accepts your request.</p>`;
}

function showError(msg) {
  const el = $("errorMsg");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideError() {
  $("errorMsg")?.classList.remove("show");
}

async function handleSubmit() {
  hideError();
  for (let s = 1; s <= TOTAL_STEPS; s++) {
    if (!validateStep(s)) {
      setWizardStep(s);
      return;
    }
  }

  const v = getFormValues();

  const next = $("wizardNext");
  const sticky = $("stickyNextBtn");
  [next, sticky].forEach((b) => {
    if (b) {
      b.disabled = true;
      b.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Sending…`;
    }
  });

  try {
    const row = buildRequestRow({
      buyer: currentUser,
      shopper: currentShopper,
      item: v,
      shopperFeePercent,
    });
    await insertRequest(row);
    invalidateOrdersCache(currentUser.uid);
    document.dispatchEvent(new CustomEvent("bfm-buyer-badges"));
  } catch (error) {
    console.error("Request error:", error);
    showError("Failed to send request. Please try again.");
    [next, sticky].forEach((b) => {
      if (b) {
        b.disabled = false;
        b.innerHTML = `<i class="fas fa-paper-plane" aria-hidden="true"></i> Send request`;
      }
    });
    setWizardStep(TOTAL_STEPS);
    return;
  }

  clearDraft();
  const formState = $("formState");
  if (formState) formState.hidden = true;
  $("requestAside")?.setAttribute("hidden", "");
  $("requestStickyCta")?.setAttribute("hidden", "");
  $("wizardSteps")?.setAttribute("hidden", "");
  $("requestProgress")?.setAttribute("hidden", "");
  const success = $("successState");
  if (success) {
    success.hidden = false;
    success.removeAttribute("hidden");
    success.classList.add("show");
    success.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function saveCurrentToWishlist() {
  const v = getFormValues();
  if (!v.productName) {
    showBuyerToast("Enter a product name first");
    return;
  }
  try {
    await addToWishlist(currentUser.uid, {
      shopper_id: currentShopper.uid,
      product_name: v.productName,
      store_name: v.storeName,
      quantity: parseInt(v.quantity, 10) || 1,
      category: v.category,
      notes: v.notes,
      budget: v.budget ? parseFloat(v.budget) : null,
      currency: v.currency,
    });
    showBuyerToast("Saved to wishlist");
    document.dispatchEvent(new CustomEvent("bfm-buyer-badges"));
  } catch (e) {
    console.error(e);
    showBuyerToast("Could not save — run supabase-phase3.sql");
  }
}

async function addCurrentToCart() {
  const v = getFormValues();
  if (!v.productName) {
    showBuyerToast("Enter a product name first");
    return;
  }
  try {
    await addToCart(currentUser.uid, {
      shopper_id: currentShopper.uid,
      shopper_name: currentShopper.name,
      product_name: v.productName,
      store_name: v.storeName,
      quantity: parseInt(v.quantity, 10) || 1,
      category: v.category,
      notes: v.notes,
      budget: v.budget ? parseFloat(v.budget) : null,
      currency: v.currency,
      address: v.address,
      country: v.country,
      phone: v.phone,
      timeline: v.timeline,
    });
    showBuyerToast("Added to cart");
    document.dispatchEvent(new CustomEvent("bfm-buyer-badges"));
  } catch (e) {
    console.error(e);
    showBuyerToast("Could not add to cart");
  }
}

function prefillBuyerDelivery(profile) {
  if (!profile) return;

  let address = profile.address || "";
  let city = profile.city || "";
  let country = profile.country || "";

  const saved = profile.saved_addresses;
  if (Array.isArray(saved) && saved.length) {
    const def = saved.find((a) => a.is_default) || saved[0];
    if (def) {
      address = def.address || address;
      city = def.city || city;
      country = def.country || country;
    }
  }

  const line = [address, city].filter(Boolean).join(", ");
  if (line && !$("address").value) $("address").value = line;
  if (country && !$("country").value) $("country").value = country;
  if (profile.phone && !$("phone").value) $("phone").value = profile.phone;
}

function renderShopperPreview(shopper) {
  const avatarEl = $("previewAvatar");
  if (shopper.avatar_url) {
    avatarEl.innerHTML = `<img src="${escapeHtml(shopper.avatar_url)}" alt="">`;
  } else {
    avatarEl.textContent = (shopper.name || "S")[0].toUpperCase();
  }

  $("previewName").innerHTML = nameWithVerifiedBadge(shopper.name || "Shopper", {
    tag: "span",
    className: "preview-name-verified",
    size: 20,
  });

  const loc = shopper.location || "—";
  const code = countryCodeFromLocation(shopper.location);
  const flag = code ? flagEmoji(code) : "";
  $("previewLocation").innerHTML = flag
    ? `${flag} ${escapeHtml(loc)}`
    : escapeHtml(loc);

  $("previewFee").textContent = shopper.fee || "—";
  $("successShopperName").textContent = shopper.name || "your shopper";

  const back = $("backToProfile");
  if (back) back.href = `shopper-profile.html?id=${encodeURIComponent(shopper.uid)}`;
}

async function init() {
  try {
    const buyer = await requireBuyerSession();
    if (!buyer) return;
    currentUser = buyer.profile;

    await initBuyerShell("request", {
      title: "Send request",
      narrow: false,
      skipAuth: true,
      user: buyer.profile,
    });

    const uid = new URLSearchParams(window.location.search).get("id");
    if (!uid) {
      window.location.assign("buyers.html");
      return;
    }

    const shopper = await fetchPublicShopper(uid);
    if (!shopper) {
      window.location.assign("buyers.html");
      return;
    }
    currentShopper = shopper;

    if (shopper.fee) {
      const match = String(shopper.fee).match(/\d+/);
      if (match) shopperFeePercent = parseInt(match[0], 10);
    }

    renderShopperPreview(shopper);
    prefillBuyerDelivery(currentUser);
    loadDraft();
    setWizardStep(1);

    $("wizardBack")?.addEventListener("click", goBack);
    $("stickyBackBtn")?.addEventListener("click", goBack);
    $("wizardNext")?.addEventListener("click", goNext);
    $("stickyNextBtn")?.addEventListener("click", goNext);

    document.querySelectorAll(".wizard-step").forEach((step) => {
      step.addEventListener("click", () => {
        const target = Number(step.dataset.step);
        if (target < wizardStep) setWizardStep(target);
        else if (target === wizardStep + 1 && validateStep(wizardStep)) setWizardStep(target);
      });
    });

    document.querySelectorAll("#formState input, #formState select, #formState textarea").forEach((el) => {
      const onChange = () => {
        saveDraft();
        updateAsideSummary();
        if (el.id === "budget" || el.id === "currency") updateFeeEstimate();
        if (el.id === "notes") updateNotesCount();
      };
      el.addEventListener("input", onChange);
      el.addEventListener("change", onChange);
    });

    $("saveWishlistBtn")?.addEventListener("click", saveCurrentToWishlist);
    $("addCartBtn")?.addEventListener("click", addCurrentToCart);

    $("notes")?.setAttribute("maxlength", "500");
    updateNotesCount();
  } catch (err) {
    console.error("Request page init error:", err);
    showError(err.message || "Could not load this page. Try signing in again.");
  }
}

document.addEventListener("DOMContentLoaded", init);

// Legacy inline handler
window.updateFeeEstimate = updateFeeEstimate;
window.handleSubmit = handleSubmit;
