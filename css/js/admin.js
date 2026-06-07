/* =============================================================
   BuyForMe — admin.js
   Protected by role = "admin" check.
   All 9 sections wired to Supabase.
   ============================================================= */

import { supabase } from "./supabase.js";
import { fetchAllTickets, updateTicketStatus } from "./api/tickets.js";
import { renderAnalyticsCharts } from "./admin-analytics.js";

/* ─── STATE ─── */
let currentAdmin  = null;
let allOrders     = [];
let allShoppers   = [];
let allBuyers     = [];
let allReviews    = [];
let allBroadcasts = [];
let allTickets    = [];
let platformSettings = {};

/* ─── INIT ─── */
document.addEventListener("DOMContentLoaded", async () => {
  // Clock
  updateClock();
  setInterval(updateClock, 1000);

  // Auth + role check
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "auth.html"; return; }

  const { data: profile } = await supabase
    .from("users").select("*").eq("uid", session.user.id).maybeSingle();

  if (!profile || profile.role !== "admin") {
    window.location.href = "index.html";
    return;
  }

  currentAdmin = profile;
  renderAdminProfile();
  await loadPlatformSettings();
  await loadAllData();
  subscribeRealtime();
});

/* ─── CLOCK ─── */
function updateClock() {
  const el = document.getElementById("topbarTime");
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ─── ADMIN PROFILE ─── */
function renderAdminProfile() {
  const name = currentAdmin.name || "Admin";
  document.getElementById("sidebarName").textContent = name;
  document.getElementById("sidebarAv").textContent   = name[0].toUpperCase();
  document.getElementById("setAdminName").value      = name;
  document.getElementById("setAdminEmail").value     = currentAdmin.email || "";
}

/* ─── SECTION NAV ─── */
window.showSection = function (id, btn) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("section-" + id)?.classList.add("active");
  if (btn) btn.classList.add("active");

  const titles = {
    overview: "Overview", orders: "Orders Management",
    payments: "Payments & Finance", disputes: "Disputes",
    shoppers: "Shoppers Management", buyers: "Buyers Management",
    reviews: "Reviews Moderation", broadcast: "Broadcast",
    tickets: "Support Tickets", settings: "Platform Settings"
  };
  document.getElementById("topbarTitle").textContent = titles[id] || id;

  // Lazy render on first visit
  if (id === "payments")  renderPaymentsSection();
  if (id === "disputes")  renderDisputesSection();
  if (id === "tickets")   renderTicketsSection();
  if (id === "shoppers")  renderShoppersSection();
  if (id === "buyers")    renderBuyersSection();
  if (id === "reviews")   renderReviewsSection();
  if (id === "broadcast") renderBroadcastSection();
};

/* ─── LOAD ALL DATA ─── */
async function loadAllData() {
  await Promise.all([
    loadOrders(),
    loadShoppers(),
    loadBuyers(),
    loadReviews(),
    loadBroadcasts(),
    loadPayouts(),
    loadTickets(),
  ]);
  renderOverview();
  renderOrdersTable();
}

/* ─── ORDERS ─── */
async function loadOrders() {
  const { data, error } = await supabase
    .from("requests").select("*");
  if (error) { console.error("loadOrders error:", error); return; }
  allOrders = (data || []).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
}

/* ─── SHOPPERS ─── */
async function loadShoppers() {
  const { data, error } = await supabase
    .from("users").select("*");
  if (error) { console.error("loadShoppers error:", error); return; }
  allShoppers = (data || []).filter(u => u.role === "shopper");
}

/* ─── BUYERS ─── */
async function loadBuyers() {
  const { data, error } = await supabase
    .from("users").select("*");
  if (error) { console.error("loadBuyers error:", error); return; }
  allBuyers = (data || []).filter(u => u.role === "buyer");
}

/* ─── REVIEWS ─── */
async function loadReviews() {
  const { data, error } = await supabase
    .from("reviews").select("*");
  if (error) { console.error("loadReviews error:", error); return; }
  allReviews = data || [];
}

async function loadTickets() {
  try {
    allTickets = await fetchAllTickets();
  } catch (e) {
    console.error("loadTickets:", e);
    allTickets = [];
  }
}

function renderTicketsSection() {
  const el = document.getElementById("ticketsTableBody");
  if (!el) return;
  if (!allTickets.length) {
    el.innerHTML = `<tr class="empty-row"><td colspan="5">No support tickets — run supabase-phase3.sql</td></tr>`;
    return;
  }
  el.innerHTML = allTickets.map((t) => `
    <tr>
      <td>${escapeHtml(t.subject)}</td>
      <td class="td-muted">${escapeHtml(t.user_name || t.user_email || "—")}</td>
      <td>${statusBadge(t.status)}</td>
      <td class="td-muted">${new Date(t.created_at).toLocaleDateString()}</td>
      <td>
        <select onchange="updateTicket('${t.id}', this.value)" class="admin-select-sm">
          <option value="open" ${t.status === "open" ? "selected" : ""}>Open</option>
          <option value="in_progress" ${t.status === "in_progress" ? "selected" : ""}>In progress</option>
          <option value="resolved" ${t.status === "resolved" ? "selected" : ""}>Resolved</option>
          <option value="closed" ${t.status === "closed" ? "selected" : ""}>Closed</option>
        </select>
      </td>
    </tr>`).join("");
}

window.updateTicket = async function (id, status) {
  try {
    await updateTicketStatus(id, status);
    await loadTickets();
    renderTicketsSection();
  } catch (e) {
    console.error(e);
    alert("Could not update ticket");
  }
};

/* ─── BROADCASTS ─── */
async function loadBroadcasts() {
  const { data, error } = await supabase
    .from("broadcasts").select("*");
  if (error) { console.error("loadBroadcasts error:", error); }
  allBroadcasts = data || [];
}

/* ─── PLATFORM SETTINGS ─── */
async function loadPlatformSettings() {
  const { data } = await supabase
    .from("platform_settings").select("*").eq("id", 1).maybeSingle();

  if (data) {
    platformSettings = data;
    if (data.platform_name) document.getElementById("setPlatformName").value = data.platform_name;
    if (data.support_email) document.getElementById("setSupportEmail").value = data.support_email;
    if (data.service_fee !== undefined) document.getElementById("setServiceFee").value = data.service_fee;
    if (data.default_currency) document.getElementById("setDefaultCurrency").value = data.default_currency;
    if (data.maintenance_mode) toggleOn("toggleMaintenance");
    if (data.shopper_reg === false) toggleOff("toggleShopperReg");
    if (data.buyer_reg   === false) toggleOff("toggleBuyerReg");
    if (data.payments_enabled === false) toggleOff("togglePayments");
  }
}

function toggleOn(id)  { document.getElementById(id)?.classList.add("on"); }
function toggleOff(id) { document.getElementById(id)?.classList.remove("on"); }

/* ══════════════════════════════════════════════
   1. OVERVIEW
══════════════════════════════════════════════ */
function renderOverview() {
  const fee = parseFloat(document.getElementById("setServiceFee")?.value || 15) / 100;

  const paid      = allOrders.filter(o => ["paid","funded","purchased","delivering","delivered"].includes(o.status));
  const delivered = allOrders.filter(o => o.status === "delivered");
  const pendingPay = allOrders.filter(o => o.status === "paid");

  const revenue     = paid.reduce((s, o) => s + (parseFloat(o.budget) || 0), 0);
  const pendingAmt  = pendingPay.reduce((s, o) => s + (parseFloat(o.budget) || 0), 0);
  const feesEarned  = delivered.reduce((s, o) => s + (parseFloat(o.budget) || 0) * fee, 0);

  document.getElementById("statRevenue").textContent        = fmt(revenue);
  document.getElementById("statPending").textContent        = fmt(pendingAmt);
  document.getElementById("statFees").textContent           = fmt(feesEarned);
  document.getElementById("statOrders").textContent         = allOrders.length;
  document.getElementById("statShoppers").textContent       = allShoppers.filter(s => s.verification_status === "approved").length;
  document.getElementById("statBuyers").textContent         = allBuyers.length;
  document.getElementById("statPendingShoppers").textContent = allShoppers.filter(s => s.verification_status?.toLowerCase() === "pending").length;

  // Badges
  const paidBadge = pendingPay.length;
  const pendingShBadge = allShoppers.filter(s => s.verification_status?.toLowerCase() === "pending").length;
  const disputedBadge = allOrders.filter(o => o.status === "disputed").length;

  setBadge("pendingPaymentBadge", paidBadge);
  setBadge("pendingShopperBadge", pendingShBadge);
  setBadge("disputeBadge", disputedBadge);

  // Recent orders table
  const recentBody = document.getElementById("recentOrdersBody");
  const recent = allOrders.slice(0, 8);
  if (recent.length === 0) {
    recentBody.innerHTML = `<tr class="empty-row"><td colspan="4">No orders yet</td></tr>`;
  } else {
    recentBody.innerHTML = recent.map(o => `
      <tr>
        <td>${o.product_name}</td>
        <td class="td-muted">${o.buyer_name || "—"}</td>
        <td>${o.currency || "₦"}${parseFloat(o.budget || 0).toLocaleString()}</td>
        <td>${statusBadge(o.status)}</td>
      </tr>`).join("");
  }

  // Activity feed
  const feed = document.getElementById("activityFeed");
  const events = allOrders.slice(0, 12).map(o => ({
    time: o.updated_at || o.created_at,
    text: activityText(o),
    color: activityColor(o.status),
  })).sort((a, b) => new Date(b.time) - new Date(a.time));

  feed.innerHTML = events.length === 0
    ? `<div class="activity-item"><div class="activity-dot" style="background:var(--muted)"></div><div><div class="activity-text">No activity yet</div></div></div>`
    : events.map(e => `
        <div class="activity-item">
          <div class="activity-dot" style="background:${e.color}"></div>
          <div>
            <div class="activity-text">${e.text}</div>
            <div class="activity-time">${timeAgo(e.time)}</div>
          </div>
        </div>`).join("");

  renderAnalyticsCharts(allOrders);
}

function activityText(o) {
  const map = {
    pending:    `📋 ${o.buyer_name} requested "${o.product_name}"`,
    quoted:     `💬 ${o.shopper_name} sent a quote for "${o.product_name}"`,
    accepted:   `✅ ${o.shopper_name} accepted "${o.product_name}"`,
    paid:       `💳 ${o.buyer_name} paid for "${o.product_name}"`,
    funded:     `🏦 Funds released to ${o.shopper_name} for "${o.product_name}"`,
    purchased:  `🛍️ ${o.shopper_name} bought "${o.product_name}"`,
    delivering: `🚚 "${o.product_name}" is being delivered`,
    delivered:  `🎉 "${o.product_name}" delivered to ${o.buyer_name}`,
    disputed:   `⚠️ Dispute raised on "${o.product_name}"`,
    cancelled:  `❌ "${o.product_name}" was cancelled`,
  };
  return map[o.status] || `Order "${o.product_name}" updated`;
}

function activityColor(status) {
  const map = {
    pending: "#6b7280", accepted: "#3b82f6", paid: "#1a9e6e",
    funded: "#8b5cf6", purchased: "#f59e0b", delivering: "#8b5cf6",
    delivered: "#1a9e6e", disputed: "#ef4444", cancelled: "#ef4444"
  };
  return map[status] || "#6b7280";
}

/* ══════════════════════════════════════════════
   2. ORDERS TABLE
══════════════════════════════════════════════ */
function renderOrdersTable(filtered = null) {
  const orders = filtered ?? allOrders;
  const body   = document.getElementById("ordersBody");

  if (orders.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="7">No orders found</td></tr>`;
    return;
  }

  body.innerHTML = orders.map(o => `
    <tr>
      <td><strong>${o.product_name}</strong></td>
      <td class="td-muted">${o.buyer_name || "—"}</td>
      <td class="td-muted">${o.shopper_name || "—"}</td>
      <td>${o.currency || "₦"}${parseFloat(o.budget || 0).toLocaleString()}</td>
      <td>${statusBadge(o.status)}</td>
      <td class="td-muted">${fmtDate(o.created_at)}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-ghost" onclick="viewOrder('${o.id}')">
            <i class="fas fa-eye"></i>
          </button>
          ${o.status === "paid" ? `
            <button class="btn btn-green" onclick="releaseFunds('${o.id}')">
              <i class="fas fa-paper-plane"></i> Release
            </button>` : ""}
          ${["funded","purchased","delivering","delivered"].includes(o.status) ? `
            <button class="btn btn-amber" onclick="openRecordPayout('${o.id}')">
              <i class="fas fa-hand-holding-usd"></i> Payout
            </button>` : ""}
          ${!["delivered","cancelled","disputed"].includes(o.status) ? `
            <button class="btn btn-red" onclick="flagDispute('${o.id}')">
              <i class="fas fa-flag"></i>
            </button>` : ""}
        </div>
      </td>
    </tr>`).join("");
}

window.filterOrdersTable = function () {
  const q      = document.getElementById("orderSearch")?.value.toLowerCase().trim() || "";
  const status = document.getElementById("orderStatusFilter")?.value || "";
  const filtered = allOrders.filter(o => {
    const matchQ = !q ||
      (o.product_name || "").toLowerCase().includes(q) ||
      (o.buyer_name   || "").toLowerCase().includes(q) ||
      (o.shopper_name || "").toLowerCase().includes(q);
    const matchS = !status || o.status === status;
    return matchQ && matchS;
  });
  renderOrdersTable(filtered);
};

/* ── VIEW ORDER MODAL ── */
window.viewOrder = function (id) {
  const o = allOrders.find(x => String(x.id) === String(id));
  if (!o) return;

  document.getElementById("orderModalTitle").textContent = `Order: ${o.product_name}`;
  document.getElementById("orderModalBody").innerHTML = `
    <div class="modal-detail-row"><span class="label">Order ID</span><span class="value td-mono">${o.id}</span></div>
    <div class="modal-detail-row"><span class="label">Product</span><span class="value">${o.product_name}</span></div>
    <div class="modal-detail-row"><span class="label">Buyer</span><span class="value">${o.buyer_name || "—"}</span></div>
    <div class="modal-detail-row"><span class="label">Shopper</span><span class="value">${o.shopper_name || "—"}</span></div>
    <div class="modal-detail-row"><span class="label">Budget</span><span class="value">${o.currency || "₦"}${parseFloat(o.budget || 0).toLocaleString()}</span></div>
    <div class="modal-detail-row"><span class="label">Status</span><span class="value">${statusBadge(o.status)}</span></div>
    <div class="modal-detail-row"><span class="label">Payment Ref</span><span class="value td-mono">${o.payment_reference || "—"}</span></div>
    <div class="modal-detail-row"><span class="label">Destination</span><span class="value">${o.address || "—"}</span></div>
    <div class="modal-detail-row"><span class="label">Notes</span><span class="value">${o.notes || "—"}</span></div>
    <div class="modal-detail-row"><span class="label">Placed</span><span class="value">${fmtDate(o.created_at)}</span></div>
    <div class="modal-detail-row"><span class="label">Paid At</span><span class="value">${o.paid_at ? fmtDate(o.paid_at) : "—"}</span></div>
  `;

  const actions = document.getElementById("orderModalActions");
  actions.innerHTML = "";

  if (o.status === "paid") {
    const btn = document.createElement("button");
    btn.className = "btn btn-green";
    btn.innerHTML = `<i class="fas fa-paper-plane"></i> Release Funds to Shopper`;
    btn.onclick = () => { closeModal("orderModal"); releaseFunds(o.id); };
    actions.appendChild(btn);
  }

  if (!["delivered","cancelled","disputed"].includes(o.status)) {
    const btn2 = document.createElement("button");
    btn2.className = "btn btn-red";
    btn2.innerHTML = `<i class="fas fa-flag"></i> Flag as Disputed`;
    btn2.onclick = () => { closeModal("orderModal"); flagDispute(o.id); };
    actions.appendChild(btn2);
  }

  document.getElementById("orderModal").classList.add("open");
};

/* ── RELEASE FUNDS ── */
window.releaseFunds = async function (id) {
  if (!confirm("Mark this order as FUNDED? This means you are releasing money to the shopper manually.")) return;

  const { error } = await supabase
    .from("requests")
    .update({ status: "funded" })
    .eq("id", id);

  if (error) { showToast("Failed to release funds.", "error"); return; }

  const idx = allOrders.findIndex(o => String(o.id) === String(id));
  if (idx !== -1) allOrders[idx].status = "funded";

  showToast("✅ Funds released! Shopper has been notified.", "success");
  renderOverview();
  renderOrdersTable();
  renderPaymentsSection();
};

/* ── FLAG DISPUTE ── */
window.flagDispute = async function (id) {
  if (!confirm("Flag this order as DISPUTED?")) return;

  const { error } = await supabase
    .from("requests").update({ status: "disputed" }).eq("id", id);

  if (error) { showToast("Failed to flag dispute.", "error"); return; }

  const idx = allOrders.findIndex(o => String(o.id) === String(id));
  if (idx !== -1) allOrders[idx].status = "disputed";

  showToast("⚠️ Order flagged as disputed.", "success");
  renderOverview();
  renderOrdersTable();
  renderDisputesSection();
};

/* ══════════════════════════════════════════════
   3. PAYMENTS & FINANCE
══════════════════════════════════════════════ */
function renderPaymentsSection() {
  const fee       = parseFloat(document.getElementById("setServiceFee")?.value || 15) / 100;
  const paid      = allOrders.filter(o => ["paid","funded","purchased","delivering","delivered"].includes(o.status));
  const funded    = allOrders.filter(o => ["funded","purchased","delivering","delivered"].includes(o.status));
  const delivered = allOrders.filter(o => o.status === "delivered");
  const paidOnly  = allOrders.filter(o => o.status === "paid");

  const revenue   = paid.reduce((s,o) => s + (parseFloat(o.budget)||0), 0);
  const released  = funded.reduce((s,o) => s + (parseFloat(o.budget)||0) * (1-fee), 0);
  const escrow    = paidOnly.reduce((s,o) => s + (parseFloat(o.budget)||0), 0);
  const fees      = delivered.reduce((s,o) => s + (parseFloat(o.budget)||0) * fee, 0);

  document.getElementById("finRevenue").textContent  = fmt(revenue);
  document.getElementById("finReleased").textContent = fmt(released);
  document.getElementById("finEscrow").textContent   = fmt(escrow);
  document.getElementById("finFees").textContent     = fmt(fees);

  const awaitBody = document.getElementById("awaitingFundBody");
  const awaiting  = allOrders.filter(o => o.status === "paid");
  if (awaiting.length === 0) {
    awaitBody.innerHTML = `<tr class="empty-row"><td colspan="7">🎉 No pending fund releases</td></tr>`;
  } else {
    awaitBody.innerHTML = awaiting.map(o => `
      <tr>
        <td><strong>${o.product_name}</strong></td>
        <td class="td-muted">${o.buyer_name || "—"}</td>
        <td class="td-muted">${o.shopper_name || "—"}</td>
        <td style="color:var(--amber);font-weight:600">${o.currency || "₦"}${parseFloat(o.budget||0).toLocaleString()}</td>
        <td class="td-muted">${o.paid_at ? fmtDate(o.paid_at) : "—"}</td>
        <td class="td-mono" style="font-size:0.68rem">${o.payment_reference || "—"}</td>
        <td>
          <button class="btn btn-green" onclick="releaseFunds('${o.id}')">
            <i class="fas fa-paper-plane"></i> Release
          </button>
        </td>
      </tr>`).join("");
  }

  renderPaymentHistory();
}

function renderPaymentHistory(query = "") {
  const body = document.getElementById("paymentHistoryBody");
  const paid = allOrders.filter(o =>
    ["paid","funded","purchased","delivering","delivered"].includes(o.status)
  );
  const filtered = query
    ? paid.filter(o =>
        (o.payment_reference || "").toLowerCase().includes(query) ||
        (o.buyer_name || "").toLowerCase().includes(query))
    : paid;

  if (filtered.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="7">No payments found</td></tr>`;
    return;
  }

  body.innerHTML = filtered.map(o => `
    <tr>
      <td>${o.product_name}</td>
      <td class="td-muted">${o.buyer_name || "—"}</td>
      <td class="td-muted">${o.shopper_name || "—"}</td>
      <td style="font-weight:600">${o.currency || "₦"}${parseFloat(o.budget||0).toLocaleString()}</td>
      <td class="td-mono" style="font-size:0.68rem">${o.payment_reference || "—"}</td>
      <td>${statusBadge(o.status)}</td>
      <td class="td-muted">${o.paid_at ? fmtDate(o.paid_at) : fmtDate(o.created_at)}</td>
    </tr>`).join("");
}

window.filterPaymentsTable = function () {
  const q = document.getElementById("paymentSearch")?.value.toLowerCase().trim() || "";
  renderPaymentHistory(q);
};

/* ══════════════════════════════════════════════
   4. DISPUTES
══════════════════════════════════════════════ */
function renderDisputesSection() {
  const disputed = allOrders.filter(o => o.status === "disputed");
  const list = document.getElementById("disputesList");

  if (disputed.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:12px">🎉</div>
        <p>No disputes at the moment. Great job!</p>
      </div>`;
    return;
  }

  list.innerHTML = disputed.map(o => `
    <div class="dispute-card flagged">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div>
          <div style="font-size:0.95rem;font-weight:700;color:var(--text)">${o.product_name}</div>
          <div class="dispute-meta">
            <span><i class="fas fa-user"></i> Buyer: ${o.buyer_name || "—"}</span>
            <span><i class="fas fa-store"></i> Shopper: ${o.shopper_name || "—"}</span>
            <span><i class="fas fa-dollar-sign"></i> ${o.currency || "₦"}${parseFloat(o.budget||0).toLocaleString()}</span>
            <span><i class="fas fa-calendar"></i> ${fmtDate(o.created_at)}</span>
          </div>
          <div style="font-size:0.78rem;color:var(--muted);margin-top:6px">
            Payment Ref: <span style="font-family:'JetBrains Mono',monospace">${o.payment_reference || "—"}</span>
          </div>
        </div>
        <div>${statusBadge("disputed")}</div>
      </div>
      <div class="dispute-actions">
        <button class="btn btn-green" onclick="resolveDispute('${o.id}','refund')">
          <i class="fas fa-undo"></i> Refund Buyer
        </button>
        <button class="btn btn-amber" onclick="resolveDispute('${o.id}','shopper')">
          <i class="fas fa-check"></i> Side with Shopper
        </button>
        <button class="btn btn-ghost" onclick="viewOrder('${o.id}')">
          <i class="fas fa-eye"></i> View Full Order
        </button>
      </div>
    </div>`).join("");
}

window.resolveDispute = async function (id, resolution) {
  if (resolution === "refund") {
    if (!confirm("Mark as REFUNDED? This will cancel the order. You handle the refund manually.")) return;

    const { error } = await supabase
      .from("requests").update({ status: "cancelled" }).eq("id", id);

    if (error) { showToast("Failed to resolve.", "error"); return; }

    const idx = allOrders.findIndex(o => String(o.id) === String(id));
    if (idx !== -1) allOrders[idx].status = "cancelled";

    showToast("✅ Order cancelled. Process the refund manually.", "success");
    renderOverview();
    renderDisputesSection();
    setBadge("disputeBadge", allOrders.filter(o => o.status === "disputed").length);

  } else {
    openRecordPayoutFromDispute(id);
  }
};

window.openRecordPayoutFromDispute = function (orderId) {
  const o = allOrders.find(x => String(x.id) === String(orderId));
  if (!o) return;

  const shopper = allShoppers.find(s => s.uid === o.shopper_id);
  const payoutMethod  = shopper?.payout_method         || "";
  const accountName   = shopper?.payout_account_name   || "";
  const accountNumber = shopper?.payout_account_number || "";
  const bankName      = shopper?.payout_bank_name      || "";
  const payoutCountry = shopper?.payout_country        || "";
  const payoutEmail   = shopper?.payout_email          || "";

  const fee    = parseFloat(document.getElementById("setServiceFee")?.value || 15) / 100;
  const amount = (parseFloat(o.budget || 0) * (1 - fee)).toFixed(2);

  const hasPayoutDetails = payoutMethod && (accountNumber || payoutEmail);

  document.getElementById("orderModalTitle").textContent = `Side with Shopper: ${o.product_name}`;
  document.getElementById("orderModalBody").innerHTML = `
    ${!hasPayoutDetails ? `
    <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:14px;margin-bottom:16px">
      <div style="color:#f87171;font-weight:600;font-size:0.85rem;margin-bottom:4px">⚠️ Shopper has not set up payout details</div>
      <div style="color:var(--muted);font-size:0.78rem">Contact ${o.shopper_name} and ask them to fill in their payout information in Settings before you send payment.</div>
    </div>` : `
    <div style="background:rgba(26,158,110,0.08);border:1px solid rgba(26,158,110,0.2);border-radius:10px;padding:14px;margin-bottom:16px">
      <div style="font-size:0.72rem;color:var(--muted);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px">📋 Send Money To This Account</div>
      <div class="modal-detail-row"><span class="label">Shopper</span><span class="value">${o.shopper_name || "—"}</span></div>
      <div class="modal-detail-row"><span class="label">Method</span><span class="value" style="color:var(--green);font-weight:700;font-size:0.9rem">${payoutMethod}</span></div>
      <div class="modal-detail-row"><span class="label">Account Name</span><span class="value">${accountName || "—"}</span></div>
      <div class="modal-detail-row"><span class="label">Account / Phone / Email</span><span class="value td-mono" style="color:var(--text);font-size:0.85rem">${accountNumber || payoutEmail || "—"}</span></div>
      ${bankName ? `<div class="modal-detail-row"><span class="label">Bank / Provider</span><span class="value">${bankName}</span></div>` : ""}
      ${payoutCountry ? `<div class="modal-detail-row"><span class="label">Country</span><span class="value">${payoutCountry}</span></div>` : ""}
    </div>`}

    <div style="font-size:0.72rem;color:var(--muted);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">Record Your Payout</div>

    <div class="form-group">
      <label>Amount to Send (USD)</label>
      <input type="number" class="form-input" id="payoutAmountInput" value="${amount}" step="0.01" min="0">
    </div>
    <div class="form-group">
      <label>Payment Method You Used</label>
      <input type="text" class="form-input" id="payoutMethodInput" value="${payoutMethod}" placeholder="e.g. Bank Transfer, PayPal">
    </div>
    <div class="form-group">
      <label>Transaction Reference / ID</label>
      <input type="text" class="form-input" id="payoutRefInput" placeholder="e.g. TXN123456789 (required)">
    </div>
    <div class="form-group">
      <label>Date Sent</label>
      <input type="date" class="form-input" id="payoutDateInput" value="${new Date().toISOString().split("T")[0]}">
    </div>
    <div class="form-group">
      <label>Note (optional)</label>
      <input type="text" class="form-input" id="payoutNoteInput" placeholder="e.g. Dispute resolved, sided with shopper">
    </div>
  `;

  const actions = document.getElementById("orderModalActions");
  actions.innerHTML = "";

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-green";
  confirmBtn.innerHTML = `<i class="fas fa-check-circle"></i> I've Sent the Money — Confirm Payout`;
  confirmBtn.onclick = () => confirmDisputePayoutAndDeliver(orderId, o.shopper_id, o.shopper_name, o.product_name);
  actions.appendChild(confirmBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-ghost";
  cancelBtn.innerHTML = `Cancel`;
  cancelBtn.onclick = () => closeModal("orderModal");
  actions.appendChild(cancelBtn);

  document.getElementById("orderModal").classList.add("open");
};

async function confirmDisputePayoutAndDeliver(orderId, shopperId, shopperName, productName) {
  const amount    = parseFloat(document.getElementById("payoutAmountInput")?.value) || 0;
  const method    = document.getElementById("payoutMethodInput")?.value.trim()  || "";
  const reference = document.getElementById("payoutRefInput")?.value.trim()     || "";
  const paidAt    = document.getElementById("payoutDateInput")?.value            || new Date().toISOString();
  const note      = document.getElementById("payoutNoteInput")?.value.trim()    || "Dispute resolved — sided with shopper";

  if (!amount || amount <= 0) { showToast("Please enter the amount you sent.", "error"); return; }
  if (!reference) { showToast("Please enter the transaction reference.", "error"); return; }

  const { error: payoutError } = await supabase.from("payouts").insert({
    order_id: orderId, shopper_id: shopperId, shopper_name: shopperName,
    product_name: productName, amount, method, reference, note,
    paid_at: new Date(paidAt).toISOString(),
  });

  if (payoutError) { showToast("Failed to record payout: " + payoutError.message, "error"); return; }

  const { error: orderError } = await supabase
    .from("requests").update({ status: "delivered" }).eq("id", orderId);

  if (orderError) { showToast("Payout recorded but order update failed.", "error"); return; }

  const idx = allOrders.findIndex(o => String(o.id) === String(orderId));
  if (idx !== -1) allOrders[idx].status = "delivered";

  closeModal("orderModal");
  showToast(`✅ Payout recorded & order marked delivered. ${shopperName} will see it in their earnings.`, "success");
  renderOverview();
  renderDisputesSection();
  renderOrdersTable();
  setBadge("disputeBadge", allOrders.filter(o => o.status === "disputed").length);
}

/* ══════════════════════════════════════════════
   5. SHOPPERS
══════════════════════════════════════════════ */
function renderShoppersSection() {
  renderPendingShoppers();
  renderAllShoppers();
}

function renderPendingShoppers(query = "") {
  const body    = document.getElementById("pendingShoppersBody");
  const pending = allShoppers.filter(s =>
    s.verification_status?.toLowerCase() === "pending" &&
    (!query || (s.name||"").toLowerCase().includes(query) || (s.email||"").toLowerCase().includes(query))
  );

  if (pending.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="5">No pending shoppers</td></tr>`;
    return;
  }

  body.innerHTML = pending.map(s => `
    <tr>
      <td><strong>${s.name || "—"}</strong></td>
      <td class="td-muted">${s.email || "—"}</td>
      <td class="td-muted">${s.location || "—"}</td>
      <td class="td-muted">${fmtDate(s.created_at)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-green" onclick="approveShoppper('${s.uid}')">
            <i class="fas fa-check"></i> Approve
          </button>
          <button class="btn btn-red" onclick="rejectShopper('${s.uid}')">
            <i class="fas fa-times"></i> Reject
          </button>
        </div>
      </td>
    </tr>`).join("");
}

function renderAllShoppers(query = "") {
  const body = document.getElementById("allShoppersBody");
  const list = allShoppers.filter(s =>
    !query ||
    (s.name||"").toLowerCase().includes(query) ||
    (s.location||"").toLowerCase().includes(query)
  );

  if (list.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="7">No shoppers found</td></tr>`;
    return;
  }

  body.innerHTML = list.map(s => {
    const shopperOrders = allOrders.filter(o => o.shopper_id === s.uid);
    const delivered     = shopperOrders.filter(o => o.status === "delivered");
    const earned        = delivered.reduce((sum, o) => sum + (parseFloat(o.budget)||0) * 0.85, 0);
    const isSuspended   = s.verification_status?.toLowerCase() === "suspended";

    return `
      <tr>
        <td><strong>${s.name || "—"}</strong></td>
        <td class="td-muted">${s.location || "—"}</td>
        <td>${s.rating || "New"} ⭐</td>
        <td>${shopperOrders.length}</td>
        <td>${fmt(earned)}</td>
        <td>${shopperStatusBadge(s.verification_status)}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost" onclick="viewShopper('${s.uid}')">
              <i class="fas fa-eye"></i>
            </button>
            ${isSuspended
              ? `<button class="btn btn-green" onclick="unsuspendUser('${s.uid}','shopper')"><i class="fas fa-unlock"></i> Restore</button>`
              : `<button class="btn btn-red"   onclick="suspendUser('${s.uid}','shopper')"><i class="fas fa-ban"></i> Suspend</button>`
            }
          </div>
        </td>
      </tr>`;
  }).join("");
}

window.filterShoppersTable = function () {
  const q = document.getElementById("shopperSearch")?.value.toLowerCase().trim() || "";
  renderPendingShoppers(q);
  renderAllShoppers(q);
};

window.approveShoppper = async function (uid) {
  const { error } = await supabase
    .from("users").update({ verification_status: "approved" }).eq("uid", uid);
  if (error) { showToast("Failed to approve.", "error"); return; }
  const idx = allShoppers.findIndex(s => s.uid === uid);
  if (idx !== -1) allShoppers[idx].verification_status = "approved";
  showToast("✅ Shopper approved!", "success");
  renderOverview();
  renderShoppersSection();
  setBadge("pendingShopperBadge", allShoppers.filter(s => s.verification_status?.toLowerCase() === "pending").length);
};

window.rejectShopper = async function (uid) {
  if (!confirm("Reject this shopper application?")) return;
  const { error } = await supabase
    .from("users").update({ verification_status: "rejected" }).eq("uid", uid);
  if (error) { showToast("Failed to reject.", "error"); return; }
  const idx = allShoppers.findIndex(s => s.uid === uid);
  if (idx !== -1) allShoppers[idx].verification_status = "rejected";
  showToast("Shopper rejected.", "success");
  renderShoppersSection();
  setBadge("pendingShopperBadge", allShoppers.filter(s => s.verification_status?.toLowerCase() === "pending").length);
};

window.suspendUser = async function (uid, role) {
  if (!confirm(`Suspend this ${role}?`)) return;
  const update = role === "shopper" ? { verification_status: "suspended" } : { suspended: true };
  const { error } = await supabase.from("users").update(update).eq("uid", uid);
  if (error) { showToast("Failed to suspend.", "error"); return; }

  if (role === "shopper") {
    const idx = allShoppers.findIndex(s => s.uid === uid);
    if (idx !== -1) allShoppers[idx].verification_status = "suspended";
    renderShoppersSection();
  } else {
    const idx = allBuyers.findIndex(b => b.uid === uid);
    if (idx !== -1) allBuyers[idx].suspended = true;
    renderBuyersSection();
  }
  showToast(`${role} suspended.`, "success");
};

window.unsuspendUser = async function (uid, role) {
  const update = role === "shopper" ? { verification_status: "approved" } : { suspended: false };
  const { error } = await supabase.from("users").update(update).eq("uid", uid);
  if (error) { showToast("Failed to restore.", "error"); return; }

  if (role === "shopper") {
    const idx = allShoppers.findIndex(s => s.uid === uid);
    if (idx !== -1) allShoppers[idx].verification_status = "approved";
    renderShoppersSection();
  } else {
    const idx = allBuyers.findIndex(b => b.uid === uid);
    if (idx !== -1) allBuyers[idx].suspended = false;
    renderBuyersSection();
  }
  showToast(`${role} restored.`, "success");
};

window.viewShopper = function (uid) {
  const s = allShoppers.find(x => x.uid === uid);
  if (!s) return;
  const shopperOrders  = allOrders.filter(o => o.shopper_id === uid);
  const delivered      = shopperOrders.filter(o => o.status === "delivered");
  const earned         = delivered.reduce((sum,o) => sum + (parseFloat(o.budget)||0) * 0.85, 0);
  const shopperReviews = allReviews.filter(r => r.shopper_id === uid);
  const shopperPayouts = allPayouts.filter(p => p.shopper_id === uid);
  const totalPaidOut   = shopperPayouts.reduce((sum,p) => sum + (parseFloat(p.amount)||0), 0);

  const hasPayout = s.payout_method && (s.payout_account_number || s.payout_email);

  document.getElementById("shopperModalTitle").textContent = s.name || "Shopper";
  document.getElementById("shopperModalBody").innerHTML = `
    <div style="font-size:0.68rem;color:var(--muted);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;margin-top:4px">👤 Profile</div>
    <div class="modal-detail-row"><span class="label">Full Name</span><span class="value">${s.name||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Email</span><span class="value">${s.email||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Phone</span><span class="value">${s.phone||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Location</span><span class="value">${s.location||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Account Status</span><span class="value">${shopperStatusBadge(s.verification_status)}</span></div>
    <div class="modal-detail-row"><span class="label">Joined</span><span class="value">${fmtDate(s.created_at)}</span></div>
    ${s.about ? `<div class="modal-detail-row"><span class="label">About</span><span class="value" style="max-width:260px;text-align:right;font-size:0.78rem">${s.about}</span></div>` : ""}

    <div style="font-size:0.68rem;color:var(--muted);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;margin-top:16px">🛍️ Shopper Profile</div>
    <div class="modal-detail-row"><span class="label">Rating</span><span class="value">${s.rating||"New"} ⭐</span></div>
    <div class="modal-detail-row"><span class="label">Service Fee</span><span class="value">${s.fee||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Response Time</span><span class="value">${s.response_time||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Completion Rate</span><span class="value">${s.completion_rate||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Years Active</span><span class="value">${s.years_active||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Specialties</span><span class="value" style="max-width:200px;text-align:right;font-size:0.78rem">${s.tags||"—"}</span></div>

    <div style="font-size:0.68rem;color:var(--muted);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;margin-top:16px">📊 Performance</div>
    <div class="modal-detail-row"><span class="label">Total Orders</span><span class="value">${shopperOrders.length}</span></div>
    <div class="modal-detail-row"><span class="label">Completed Orders</span><span class="value">${delivered.length}</span></div>
    <div class="modal-detail-row"><span class="label">Total Reviews</span><span class="value">${shopperReviews.length}</span></div>
    <div class="modal-detail-row"><span class="label">Total Earned (85%)</span><span class="value" style="color:var(--green);font-weight:600">${fmt(earned)}</span></div>
    <div class="modal-detail-row"><span class="label">Total Paid Out</span><span class="value" style="color:var(--green);font-weight:600">${fmt(totalPaidOut)}</span></div>

    <div style="font-size:0.68rem;color:var(--muted);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;margin-top:16px">💳 Payout Details</div>
    ${!hasPayout ? `
    <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:12px;font-size:0.78rem;color:#f87171">
      ⚠️ This shopper has not set up their payout details yet. Ask them to go to Settings → Payout Information and fill it in.
    </div>` : `
    <div class="modal-detail-row"><span class="label">Payout Method</span><span class="value" style="color:var(--green);font-weight:600">${s.payout_method||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Account Name</span><span class="value">${s.payout_account_name||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Account Number / Phone</span><span class="value td-mono">${s.payout_account_number||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Bank / Provider</span><span class="value">${s.payout_bank_name||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Email (PayPal/Wise)</span><span class="value">${s.payout_email||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Country</span><span class="value">${s.payout_country||"—"}</span></div>`}
  `;

  const actions = document.getElementById("shopperModalActions");
  actions.innerHTML = "";

  if (s.verification_status?.toLowerCase() === "suspended") {
    const btn = document.createElement("button");
    btn.className = "btn btn-green";
    btn.innerHTML = `<i class="fas fa-unlock"></i> Restore Shopper`;
    btn.onclick = () => { closeModal("shopperModal"); unsuspendUser(uid, "shopper"); };
    actions.appendChild(btn);
  } else {
    const btn = document.createElement("button");
    btn.className = "btn btn-red";
    btn.innerHTML = `<i class="fas fa-ban"></i> Suspend Shopper`;
    btn.onclick = () => { closeModal("shopperModal"); suspendUser(uid, "shopper"); };
    actions.appendChild(btn);
  }

  document.getElementById("shopperModal").classList.add("open");
};

/* ══════════════════════════════════════════════
   6. BUYERS
══════════════════════════════════════════════ */
function renderBuyersSection(query = "") {
  const body = document.getElementById("allBuyersBody");
  const list = allBuyers.filter(b =>
    !query ||
    (b.name||"").toLowerCase().includes(query) ||
    (b.email||"").toLowerCase().includes(query)
  );

  if (list.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="7">No buyers found</td></tr>`;
    return;
  }

  body.innerHTML = list.map(b => {
    const buyerOrders = allOrders.filter(o => o.buyer_id === b.uid);
    const spent       = buyerOrders
      .filter(o => ["paid","funded","purchased","delivering","delivered"].includes(o.status))
      .reduce((s,o) => s + (parseFloat(o.budget)||0), 0);
    const isSuspended = b.suspended;

    return `
      <tr>
        <td><strong>${b.name || "—"}</strong></td>
        <td class="td-muted">${b.email || "—"}</td>
        <td class="td-muted">${b.country || b.location || "—"}</td>
        <td>${buyerOrders.length}</td>
        <td>${fmt(spent)}</td>
        <td class="td-muted">${fmtDate(b.created_at)}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost" onclick="viewBuyer('${b.uid}')"><i class="fas fa-eye"></i></button>
            ${isSuspended
              ? `<button class="btn btn-green" onclick="unsuspendUser('${b.uid}','buyer')"><i class="fas fa-unlock"></i> Restore</button>`
              : `<button class="btn btn-red"   onclick="suspendUser('${b.uid}','buyer')"><i class="fas fa-ban"></i> Suspend</button>`
            }
          </div>
        </td>
      </tr>`;
  }).join("");
}

window.filterBuyersTable = function () {
  const q = document.getElementById("buyerSearch")?.value.toLowerCase().trim() || "";
  renderBuyersSection(q);
};

window.viewBuyer = function (uid) {
  const b = allBuyers.find(x => x.uid === uid);
  if (!b) return;

  const buyerOrders   = allOrders.filter(o => o.buyer_id === uid);
  const totalSpent    = buyerOrders
    .filter(o => ["paid","funded","purchased","delivering","delivered"].includes(o.status))
    .reduce((s,o) => s + (parseFloat(o.budget)||0), 0);
  const delivered     = buyerOrders.filter(o => o.status === "delivered").length;
  const disputed      = buyerOrders.filter(o => o.status === "disputed").length;
  const isSuspended   = b.suspended;

  document.getElementById("shopperModalTitle").textContent = b.name || "Buyer";
  document.getElementById("shopperModalBody").innerHTML = `
    <div style="font-size:0.68rem;color:var(--muted);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;margin-top:4px">👤 Profile</div>
    <div class="modal-detail-row"><span class="label">Full Name</span><span class="value">${b.name||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Email</span><span class="value">${b.email||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Phone</span><span class="value">${b.phone||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Country</span><span class="value">${b.country||b.location||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Account Status</span><span class="value">${isSuspended ? '<span class="badge badge-red">Suspended</span>' : '<span class="badge badge-green">Active</span>'}</span></div>
    <div class="modal-detail-row"><span class="label">Joined</span><span class="value">${fmtDate(b.created_at)}</span></div>

    <div style="font-size:0.68rem;color:var(--muted);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;margin-top:16px">📦 Shipping</div>
    <div class="modal-detail-row"><span class="label">Address</span><span class="value">${b.address||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">City</span><span class="value">${b.city||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Country</span><span class="value">${b.country||"—"}</span></div>

    <div style="font-size:0.68rem;color:var(--muted);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;margin-top:16px">💳 Payment Preferences</div>
    <div class="modal-detail-row"><span class="label">Preferred Currency</span><span class="value">${b.currency||"—"}</span></div>
    <div class="modal-detail-row"><span class="label">Payment Method</span><span class="value">${b.payment||"—"}</span></div>

    <div style="font-size:0.68rem;color:var(--muted);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;margin-top:16px">📊 Order History</div>
    <div class="modal-detail-row"><span class="label">Total Orders</span><span class="value">${buyerOrders.length}</span></div>
    <div class="modal-detail-row"><span class="label">Completed</span><span class="value">${delivered}</span></div>
    <div class="modal-detail-row"><span class="label">Disputes Raised</span><span class="value" style="${disputed > 0 ? "color:var(--red)" : ""}">${disputed}</span></div>
    <div class="modal-detail-row"><span class="label">Total Spent</span><span class="value" style="color:var(--green);font-weight:600">${fmt(totalSpent)}</span></div>
  `;

  const actions = document.getElementById("shopperModalActions");
  actions.innerHTML = "";

  if (isSuspended) {
    const btn = document.createElement("button");
    btn.className = "btn btn-green";
    btn.innerHTML = `<i class="fas fa-unlock"></i> Restore Buyer`;
    btn.onclick = () => { closeModal("shopperModal"); unsuspendUser(uid, "buyer"); };
    actions.appendChild(btn);
  } else {
    const btn = document.createElement("button");
    btn.className = "btn btn-red";
    btn.innerHTML = `<i class="fas fa-ban"></i> Suspend Buyer`;
    btn.onclick = () => { closeModal("shopperModal"); suspendUser(uid, "buyer"); };
    actions.appendChild(btn);
  }

  document.getElementById("shopperModal").classList.add("open");
};

/* ══════════════════════════════════════════════
   7. REVIEWS
══════════════════════════════════════════════ */
function renderReviewsSection(starFilter = "") {
  const body = document.getElementById("reviewsBody");
  const list = allReviews.filter(r => !starFilter || String(r.stars) === String(starFilter));

  if (list.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">No reviews found</td></tr>`;
    return;
  }

  body.innerHTML = list.map(r => `
    <tr>
      <td>${r.buyer_name || "—"}</td>
      <td class="td-muted">${r.shopper_name || r.shopper_id?.slice(0,8) || "—"}</td>
      <td>${"⭐".repeat(r.stars || 0)}</td>
      <td style="max-width:240px;font-size:0.78rem;color:var(--muted)">${r.text || "—"}</td>
      <td class="td-muted">${fmtDate(r.created_at)}</td>
      <td>
        <button class="btn btn-red" onclick="deleteReview('${r.id}')">
          <i class="fas fa-trash"></i> Delete
        </button>
      </td>
    </tr>`).join("");
}

window.filterReviewsTable = function () {
  const star = document.getElementById("reviewStarFilter")?.value || "";
  renderReviewsSection(star);
};

window.deleteReview = async function (id) {
  if (!confirm("Delete this review permanently?")) return;
  const { error } = await supabase.from("reviews").delete().eq("id", id);
  if (error) { showToast("Failed to delete review.", "error"); return; }
  allReviews = allReviews.filter(r => r.id !== id);
  showToast("Review deleted.", "success");
  renderReviewsSection();
};

/* ══════════════════════════════════════════════
   8. BROADCAST
══════════════════════════════════════════════ */
function renderBroadcastSection() {
  const body = document.getElementById("broadcastHistory");
  if (allBroadcasts.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="4">No broadcasts sent yet</td></tr>`;
    return;
  }
  body.innerHTML = allBroadcasts.map(b => `
    <tr>
      <td><strong>${b.title || "—"}</strong></td>
      <td>${b.target === "all" ? "Everyone" : b.target === "buyers" ? "Buyers" : "Shoppers"}</td>
      <td style="max-width:300px;font-size:0.78rem;color:var(--muted)">${b.message || "—"}</td>
      <td class="td-muted">${fmtDate(b.created_at)}</td>
    </tr>`).join("");
}

window.sendBroadcast = async function () {
  const target  = document.getElementById("broadcastTarget").value;
  const title   = document.getElementById("broadcastTitle").value.trim();
  const message = document.getElementById("broadcastBody").value.trim();

  if (!title || !message) { showToast("Please fill in title and message.", "error"); return; }

  const { error } = await supabase.from("broadcasts").insert({
    target, title, message,
    sent_by: currentAdmin.uid,
    created_at: new Date().toISOString()
  });

  if (error) { showToast("Failed to send broadcast.", "error"); return; }

  showToast(`✅ Broadcast sent to ${target === "all" ? "everyone" : target}!`, "success");
  clearBroadcast();
  await loadBroadcasts();
  renderBroadcastSection();
};

window.clearBroadcast = function () {
  document.getElementById("broadcastTitle").value = "";
  document.getElementById("broadcastBody").value  = "";
};

/* ══════════════════════════════════════════════
   9. SETTINGS
══════════════════════════════════════════════ */
window.toggleSetting = function (id) {
  document.getElementById(id)?.classList.toggle("on");
};

window.savePlatformSettings = async function () {
  const settings = {
    id:                1,
    platform_name:     document.getElementById("setPlatformName").value.trim(),
    support_email:     document.getElementById("setSupportEmail").value.trim(),
    service_fee:       parseFloat(document.getElementById("setServiceFee").value) || 15,
    default_currency:  document.getElementById("setDefaultCurrency").value,
    maintenance_mode:  document.getElementById("toggleMaintenance").classList.contains("on"),
    shopper_reg:       document.getElementById("toggleShopperReg").classList.contains("on"),
    buyer_reg:         document.getElementById("toggleBuyerReg").classList.contains("on"),
    payments_enabled:  document.getElementById("togglePayments").classList.contains("on"),
  };

  const { error } = await supabase
    .from("platform_settings").upsert(settings);

  if (error) { showToast("Failed to save settings.", "error"); return; }

  platformSettings = settings;
  showToast("✅ Settings saved!", "success");
};

window.saveAdminProfile = async function () {
  const name = document.getElementById("setAdminName").value.trim();
  if (!name) { showToast("Name cannot be empty.", "error"); return; }

  const { error } = await supabase
    .from("users").update({ name }).eq("uid", currentAdmin.uid);

  if (error) { showToast("Failed to update profile.", "error"); return; }

  currentAdmin.name = name;
  renderAdminProfile();
  showToast("✅ Admin profile updated!", "success");
};

/* ─── REALTIME ─── */
function subscribeRealtime() {
  supabase.channel("admin-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, async () => {
      await loadOrders();
      renderOverview();
      renderOrdersTable();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "users" }, async () => {
      await loadShoppers();
      await loadBuyers();
      renderOverview();
    })
    .subscribe();
}

/* ─── MODAL ─── */
window.closeModal = function (id) {
  document.getElementById(id)?.classList.remove("open");
};

/* ─── TOAST ─── */
function showToast(msg, type = "success") {
  const toast = document.getElementById("toast");
  const icon  = document.getElementById("toastIcon");
  const text  = document.getElementById("toastMsg");

  if (!toast) return;

  text.textContent = msg;
  toast.className  = `toast ${type} show`;
  icon.className   = type === "success" ? "fas fa-check-circle" : "fas fa-exclamation-circle";

  setTimeout(() => { toast.className = "toast"; }, 3500);
}
window.showToast = showToast;

/* ─── LOGOUT ─── */
window.handleLogout = async function () {
  await supabase.auth.signOut();
  window.location.href = "auth.html";
};

/* ─── HELPERS ─── */
function fmt(n) {
  const currency = platformSettings.default_currency === "USD" ? "$"
    : platformSettings.default_currency === "GHS" ? "₵"
    : platformSettings.default_currency === "KES" ? "KSh" : "₦";
  return `${currency}${parseFloat(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

function statusBadge(status) {
  const map = {
    pending:    ["amber",  "Request Sent"],
    accepted:   ["blue",   "Accepted"],
    paid:       ["green",  "Paid"],
    funded:     ["purple", "Funded"],
    purchased:  ["green",  "Purchased"],
    delivering: ["purple", "Delivering"],
    delivered:  ["gray",   "Delivered"],
    disputed:   ["red",    "Disputed"],
    cancelled:  ["red",    "Cancelled"],
  };
  const [color, label] = map[status] || ["gray", status];
  return `<span class="badge badge-${color}">${label}</span>`;
}

function shopperStatusBadge(status) {
  const s = (status || "").toLowerCase();
  if (s === "approved")  return `<span class="badge badge-green">Approved</span>`;
  if (s === "pending")   return `<span class="badge badge-amber">Pending</span>`;
  if (s === "suspended") return `<span class="badge badge-red">Suspended</span>`;
  if (s === "rejected")  return `<span class="badge badge-red">Rejected</span>`;
  return `<span class="badge badge-gray">${status || "—"}</span>`;
}

function setBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent   = count;
  el.style.display = count > 0 ? "inline-block" : "none";
}

/* ══════════════════════════════════════════════
   PAYOUT SYSTEM — Record Payout Modal
══════════════════════════════════════════════ */
let allPayouts = [];

async function loadPayouts() {
  const { data, error } = await supabase.from("payouts").select("*");
  if (error) { console.error("loadPayouts error:", error); }
  allPayouts = data || [];
}

window.openRecordPayout = function (orderId) {
  const o = allOrders.find(x => String(x.id) === String(orderId));
  if (!o) return;

  const shopper = allShoppers.find(s => s.uid === o.shopper_id);
  const payoutMethod  = shopper?.payout_method         || "—";
  const accountName   = shopper?.payout_account_name   || "—";
  const accountNumber = shopper?.payout_account_number || "—";
  const bankName      = shopper?.payout_bank_name      || "—";
  const payoutCountry = shopper?.payout_country        || "—";
  const payoutEmail   = shopper?.payout_email          || "—";

  const fee    = parseFloat(document.getElementById("setServiceFee")?.value || 15) / 100;
  const amount = (parseFloat(o.budget || 0) * (1 - fee)).toFixed(2);

  document.getElementById("orderModalTitle").textContent = `Record Payout: ${o.product_name}`;
  document.getElementById("orderModalBody").innerHTML = `
    <div style="background:rgba(26,158,110,0.08);border:1px solid rgba(26,158,110,0.2);border-radius:10px;padding:14px;margin-bottom:16px">
      <div style="font-size:0.72rem;color:var(--muted);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Shopper Payout Details</div>
      <div class="modal-detail-row"><span class="label">Shopper</span><span class="value">${o.shopper_name || "—"}</span></div>
      <div class="modal-detail-row"><span class="label">Method</span><span class="value" style="color:var(--green);font-weight:600">${payoutMethod}</span></div>
      <div class="modal-detail-row"><span class="label">Account Name</span><span class="value">${accountName}</span></div>
      <div class="modal-detail-row"><span class="label">Account / Phone / Email</span><span class="value td-mono">${accountNumber || payoutEmail}</span></div>
      ${bankName !== "—" ? `<div class="modal-detail-row"><span class="label">Bank / Provider</span><span class="value">${bankName}</span></div>` : ""}
      ${payoutCountry !== "—" ? `<div class="modal-detail-row"><span class="label">Country</span><span class="value">${payoutCountry}</span></div>` : ""}
    </div>

    <div style="font-size:0.72rem;color:var(--muted);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">Record This Payout</div>

    <div class="form-group">
      <label>Amount Sent (USD)</label>
      <input type="number" class="form-input" id="payoutAmountInput" value="${amount}" step="0.01" min="0">
    </div>
    <div class="form-group">
      <label>Payment Method Used</label>
      <input type="text" class="form-input" id="payoutMethodInput" value="${payoutMethod}" placeholder="e.g. Bank Transfer">
    </div>
    <div class="form-group">
      <label>Reference / Transaction ID</label>
      <input type="text" class="form-input" id="payoutRefInput" placeholder="e.g. TXN123456789">
    </div>
    <div class="form-group">
      <label>Date Sent</label>
      <input type="date" class="form-input" id="payoutDateInput" value="${new Date().toISOString().split('T')[0]}">
    </div>
    <div class="form-group">
      <label>Note (optional)</label>
      <input type="text" class="form-input" id="payoutNoteInput" placeholder="e.g. Sent via Wise">
    </div>
  `;

  const actions = document.getElementById("orderModalActions");
  actions.innerHTML = "";

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-green";
  confirmBtn.innerHTML = `<i class="fas fa-check-circle"></i> Confirm Payout Recorded`;
  confirmBtn.onclick = () => saveRecordedPayout(orderId, o.shopper_id, o.shopper_name, o.product_name);
  actions.appendChild(confirmBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-ghost";
  cancelBtn.innerHTML = `Cancel`;
  cancelBtn.onclick = () => closeModal("orderModal");
  actions.appendChild(cancelBtn);

  document.getElementById("orderModal").classList.add("open");
};

async function saveRecordedPayout(orderId, shopperId, shopperName, productName) {
  const amount    = parseFloat(document.getElementById("payoutAmountInput")?.value) || 0;
  const method    = document.getElementById("payoutMethodInput")?.value.trim()  || "";
  const reference = document.getElementById("payoutRefInput")?.value.trim()     || "";
  const paidAt    = document.getElementById("payoutDateInput")?.value            || new Date().toISOString();
  const note      = document.getElementById("payoutNoteInput")?.value.trim()    || "";

  if (!amount || amount <= 0) { showToast("Please enter a valid amount.", "error"); return; }
  if (!reference) { showToast("Please enter a transaction reference.", "error"); return; }

  const { error } = await supabase.from("payouts").insert({
    order_id:     orderId,
    shopper_id:   shopperId,
    shopper_name: shopperName,
    product_name: productName,
    amount,
    method,
    reference,
    note,
    paid_at: new Date(paidAt).toISOString(),
  });

  if (error) { showToast("Failed to record payout: " + error.message, "error"); return; }

  closeModal("orderModal");
  showToast(`✅ Payout of $${amount} recorded for ${shopperName}!`, "success");
  await loadPayouts();
}