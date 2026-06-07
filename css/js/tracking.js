/* =============================================================
   BuyForMe — tracking.js
   Premium order tracking with realtime updates.
   ============================================================= */

import { getSessionUser } from "./api/session.js";
import {
  fetchOrderWithShopper,
  subscribeOrderUpdates,
  unsubscribeOrder,
  ORDER_STATUS_EVENTS,
  ORDER_BADGE_CLASS,
  formatOrderRef,
  getTimelineStatuses,
  getProgressStep,
} from "./api/orders.js";
import { formatDate, showToast } from "./ui/index.js";
import { initI18n } from "./i18n/index.js";
import { initBuyerShell } from "./buyer-shell.js";

let currentUser = null;
let currentOrder = null;
let realtimeChannel = null;

const TOTAL_STEPS = 7;

const CARRIER_URLS = {
  dhl: "https://www.dhl.com/global-en/home/tracking.html?tracking-id=",
  fedex: "https://www.fedex.com/fedextrack/?trknbr=",
  ups: "https://www.ups.com/track?tracknum=",
  aramex: "https://www.aramex.com/track/results?ShipmentNumber=",
  usps: "https://tools.usps.com/go/TrackConfirmAction?tLabels=",
};

function carrierTrackUrl(carrier, trackingNumber) {
  if (!carrier || !trackingNumber) return null;
  const key = String(carrier).toLowerCase().replace(/[^a-z]/g, "");
  const prefix = CARRIER_URLS[key];
  if (prefix) return prefix + encodeURIComponent(trackingNumber);
  return `https://www.google.com/search?q=${encodeURIComponent(carrier + " " + trackingNumber + " tracking")}`;
}

function renderShipmentDetails(order) {
  const panel = document.getElementById("shipmentDetails");
  if (!panel) return;

  const show = order.tracking_number || order.carrier || order.estimated_delivery;
  panel.style.display = show ? "block" : "none";
  if (!show) return;

  document.getElementById("shipCarrier").textContent = order.carrier || "—";
  document.getElementById("shipTracking").textContent = order.tracking_number || "—";
  document.getElementById("shipEta").textContent = order.estimated_delivery
    ? formatDate(order.estimated_delivery, { year: "numeric", month: "short", day: "numeric" })
    : "—";

  const link = document.getElementById("shipTrackLink");
  const url = carrierTrackUrl(order.carrier, order.tracking_number);
  if (link && url) {
    link.href = url;
    link.style.display = "inline-flex";
  } else if (link) {
    link.style.display = "none";
  }
}

function renderOrder(order, isBuyer) {
  currentOrder = order;

  document.getElementById("loadingState").style.display = "none";
  document.getElementById("trackingCard").style.display = "block";

  document.getElementById("orderRef").textContent = formatOrderRef(order.id);

  const badge = document.getElementById("statusBadge");
  const label = order.status.charAt(0).toUpperCase() + order.status.slice(1);
  badge.textContent = label;
  badge.className = `bfm-badge ${ORDER_BADGE_CLASS[order.status] || "bfm-badge--pending"}`;

  document.getElementById("sumProduct").textContent = order.product_name || "—";
  document.getElementById("sumBudget").textContent =
    `${order.currency || "₦"}${order.budget || "—"}`;
  document.getElementById("sumAddress").textContent = order.address || "—";
  document.getElementById("sumDate").textContent = formatDate(order.created_at);

  const notesWrap = document.getElementById("sumNotesWrap");
  if (order.notes && notesWrap) {
    notesWrap.style.display = "";
    document.getElementById("sumNotes").textContent = order.notes;
  }

  if (order.quote_notes) {
    const qWrap = document.getElementById("sumQuoteWrap");
    if (qWrap) {
      qWrap.style.display = "";
      document.getElementById("sumQuote").textContent = order.quote_notes;
    }
  }

  updateProgress(order.status);
  renderShipmentDetails(order);

  const paymentBanner = document.getElementById("paymentBanner");
  if (paymentBanner) {
    const showPayment =
      isBuyer && (order.status === "accepted" || order.status === "payment");
    paymentBanner.style.display = showPayment ? "flex" : "none";
  }

  if (order.shopper_name) {
    document.getElementById("shopperRow").style.display = "flex";
    document.getElementById("shopperName").textContent = order.shopper_name;
    const av = document.getElementById("shopperAv");
    if (order.shopper_avatar) {
      av.innerHTML = `<img src="${order.shopper_avatar}" alt="">`;
    } else {
      av.textContent = (order.shopper_name[0] || "S").toUpperCase();
    }
  }

  renderTimeline(order.status);
}

function updateProgress(status) {
  const step = getProgressStep(status);

  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const el = document.getElementById("step" + i);
    if (!el) continue;
    el.classList.remove("done", "current");
    if (i < step) el.classList.add("done");
    if (i === step) el.classList.add("current");
  }

  const pct = ((step - 1) / (TOTAL_STEPS - 1)) * 100;
  const line = document.getElementById("progressLine");
  if (line) line.style.width = pct + "%";
}

function renderTimeline(currentStatus) {
  const list = document.getElementById("timelineList");
  if (!list) return;

  const reached = getTimelineStatuses(currentStatus);

  list.innerHTML = [...reached].reverse().map((s, i) => {
    const label = ORDER_STATUS_EVENTS[s] || s;
    const idle = i !== 0;
    return `
      <div class="tl-item" style="animation-delay:${i * 0.06}s">
        <div class="tl-dot ${idle ? "idle" : ""}"></div>
        <div class="tl-content">
          <p>${label}</p>
          <span>${idle ? "Earlier" : "Most recent update"}</span>
        </div>
      </div>`;
  }).join("");

  if (!list.innerHTML) {
    list.innerHTML = `
      <div class="tl-item">
        <div class="tl-dot idle"></div>
        <div class="tl-content">
          <p>Order created</p>
          <span>Waiting for shopper response</span>
        </div>
      </div>`;
  }
}

function showError(msg) {
  document.getElementById("loadingState").style.display = "none";
  document.getElementById("errorState").style.display = "block";
  document.getElementById("errorMsg").textContent = msg;
}

async function init() {
  initI18n();
  const profile = await initBuyerShell("orders", { title: "Track order" });
  if (!profile) return;

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("order_id");

  if (!orderId) {
    showError("No order ID found. Please go back to My Orders.");
    return;
  }

  currentUser = await getSessionUser("email, name, role, uid");

  let order;
  try {
    order = await fetchOrderWithShopper(orderId);
  } catch {
    showError("Order not found. It may have been removed.");
    return;
  }

  if (!order) {
    showError("Order not found. It may have been removed.");
    return;
  }

  const isBuyer = currentUser && order.buyer_id === currentUser.id;
  renderOrder(order, isBuyer);

  if (realtimeChannel) unsubscribeOrder(realtimeChannel);
  realtimeChannel = subscribeOrderUpdates(orderId, (updated) => {
    if (currentOrder) {
      updated.shopper_name = currentOrder.shopper_name;
      updated.shopper_avatar = currentOrder.shopper_avatar;
    }
    renderOrder(updated, currentUser && updated.buyer_id === currentUser.id);
    showToast(`Status updated: ${updated.status}`, "success");
  });
}

document.addEventListener("DOMContentLoaded", init);
