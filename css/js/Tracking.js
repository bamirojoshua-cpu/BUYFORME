/* =============================================================
   BuyForMe — tracking.js
   Reads ?order_id= from URL, fetches real order from Supabase,
   shows payment banner (buyer only, when status = accepted),
   and subscribes to realtime updates so the progress bar
   and timeline stay live without any page refresh.
   ============================================================= */

import { supabase } from "./supabase.js";

/* ─── STATE ─── */
let currentUser     = null;
let currentOrder    = null;
let realtimeChannel = null;

/* ─── STATUS → STEP (1-indexed, 6 steps total) ───────────────
   1 = Sent  2 = Accepted  3 = Paid
   4 = Purchased  5 = Shipping  6 = Arrived
──────────────────────────────────────────────────────────── */
const STATUS_STEP = {
  pending:    1,
  accepted:   2,
  payment:    2,   // stuck at accepted step — waiting for buyer to pay
  paid:       3,
  purchased:  4,
  delivering: 5,
  delivered:  6,
};

/* ─── TIMELINE COPY ─── */
const STATUS_EVENTS = {
  pending:    "Order sent to shopper",
  accepted:   "Shopper accepted your order",
  payment:    "Awaiting your payment",
  paid:       "Payment confirmed",
  purchased:  "Shopper bought the item",
  delivering: "Item is on its way to you",
  delivered:  "Order delivered! 🎉",
};

const STATUS_ORDER = ["pending", "accepted", "paid", "purchased", "delivering", "delivered"];

/* ─── HELPERS ─── */
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  setTimeout(() => { t.className = "toast"; }, 3200);
}

function badgeClass(status) {
  const map = {
    pending:    "badge-pending",
    accepted:   "badge-accepted",
    payment:    "badge-payment",
    paid:       "badge-paid",
    purchased:  "badge-purchased",
    delivering: "badge-delivering",
    delivered:  "badge-delivered",
  };
  return map[status] || "badge-pending";
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/* ─── RENDER ORDER ─── */
function renderOrder(order, isBuyer) {
  currentOrder = order;

  // Swap loading → card
  document.getElementById("loadingState").style.display = "none";
  document.getElementById("trackingCard").style.display = "block";

  // Order ref
  document.getElementById("orderRef").textContent =
    `Order #BFM-${order.id.slice(0, 8).toUpperCase()}`;

  // Status badge
  const badge = document.getElementById("statusBadge");
  badge.textContent = order.status.charAt(0).toUpperCase() + order.status.slice(1);
  badge.className   = `status-badge ${badgeClass(order.status)}`;

  // Summary fields
  document.getElementById("sumProduct").textContent =
    order.product_name || "—";
  document.getElementById("sumBudget").textContent  =
    `${order.currency || "₦"}${order.budget || "—"}`;
  document.getElementById("sumAddress").textContent =
    order.address || "—";
  document.getElementById("sumDate").textContent    =
    formatDate(order.created_at);

  if (order.notes) {
    document.getElementById("sumNotesWrap").style.display = "";
    document.getElementById("sumNotes").textContent       = order.notes;
  }

  // Progress bar + steps
  updateProgress(order.status);

  // Payment banner — buyer only, when status is accepted or payment
  const showPayment =
    isBuyer && (order.status === "accepted" || order.status === "payment");
  document.getElementById("paymentBanner").style.display =
    showPayment ? "flex" : "none";

  // Shopper row
  if (order.shopper_name) {
    document.getElementById("shopperRow").style.display  = "flex";
    document.getElementById("shopperName").textContent   = order.shopper_name;
    const av = document.getElementById("shopperAv");
    if (order.shopper_avatar) {
      av.innerHTML = `<img src="${order.shopper_avatar}" alt="${order.shopper_name}">`;
    } else {
      av.textContent = (order.shopper_name[0] || "S").toUpperCase();
    }
  }

  // Timeline
  renderTimeline(order.status);
}

/* ─── PROGRESS BAR ─── */
function updateProgress(status) {
  const step       = STATUS_STEP[status] || 1;
  const totalSteps = 6;

  for (let i = 1; i <= totalSteps; i++) {
    const el = document.getElementById("step" + i);
    if (!el) continue;
    el.classList.remove("done", "current");
    if (i < step)  el.classList.add("done");
    if (i === step) el.classList.add("current");
  }

  // Line width: spans step-1 centre → step-6 centre
  const pct = ((step - 1) / (totalSteps - 1)) * 100;
  document.getElementById("progressLine").style.width = pct + "%";
}

/* ─── TIMELINE ─── */
function renderTimeline(currentStatus) {
  const list   = document.getElementById("timelineList");
  const lookup = currentStatus === "payment" ? "accepted" : currentStatus;
  const curIdx = STATUS_ORDER.indexOf(lookup);
  const reached = STATUS_ORDER.slice(0, curIdx + 1);

  list.innerHTML = [...reached].reverse().map((s, i) => {
    const label = STATUS_EVENTS[s] || s;
    const idle  = i !== 0;
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

/* ─── PAYMENT ───────────────────────────────────────────────
   Payment is handled in my-orders.html, not here.
   This page is read-only tracking only.
──────────────────────────────────────────────────────────── */

/* ─── REALTIME ─── */
function subscribeRealtime(orderId) {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);

  realtimeChannel = supabase
    .channel("tracking-order-" + orderId)
    .on(
      "postgres_changes",
      {
        event:  "UPDATE",
        schema: "public",
        table:  "requests",
        filter: `id=eq.${orderId}`,
      },
      (payload) => {
        const updated = payload.new;
        const isBuyer = currentUser && updated.buyer_id === currentUser.id;

        // Preserve shopper info we already fetched (not in the requests row)
        if (currentOrder) {
          updated.shopper_name   = currentOrder.shopper_name;
          updated.shopper_avatar = currentOrder.shopper_avatar;
        }

        renderOrder(updated, isBuyer);
        showToast(`📦 Status updated: ${updated.status}`, "success");
      }
    )
    .subscribe();
}

/* ─── SHOW ERROR ─── */
function showError(msg) {
  document.getElementById("loadingState").style.display = "none";
  document.getElementById("errorState").style.display   = "block";
  document.getElementById("errorMsg").textContent       = msg;
}

/* ─── INIT ─── */
async function init() {
  const params  = new URLSearchParams(window.location.search);
  const orderId = params.get("order_id");

  if (!orderId) {
    showError("No order ID found. Please go back to My Orders.");
    return;
  }

  // Identify the viewer via Supabase session
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    currentUser = { id: session.user.id, email: session.user.email };

    const { data: profile } = await supabase
      .from("users")
      .select("email, name, role")
      .eq("uid", session.user.id)
      .maybeSingle();

    if (profile) {
      currentUser.email = profile.email || session.user.email;
      currentUser.name  = profile.name  || "Buyer";
      currentUser.role  = profile.role  || "buyer";
    }
  }

  // Fetch the order
  const { data: order, error } = await supabase
    .from("requests")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    showError("Order not found. It may have been removed.");
    return;
  }

  // Determine if viewer is the buyer
  const isBuyer = currentUser && order.buyer_id === currentUser.id;

  // Fetch shopper's name + avatar from users table
  if (order.shopper_id) {
    const { data: shopperProfile } = await supabase
      .from("public_shoppers")
      .select("name, avatar_url")
      .eq("uid", order.shopper_id)
      .maybeSingle();

    if (shopperProfile) {
      order.shopper_name   = shopperProfile.name;
      order.shopper_avatar = shopperProfile.avatar_url;
    }
  }

  renderOrder(order, isBuyer);
  subscribeRealtime(orderId);
}

document.addEventListener("DOMContentLoaded", init);