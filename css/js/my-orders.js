import { supabase } from "./supabase.js";
import { PAYSTACK_PUBLIC_KEY, STRIPE_PUBLISHABLE_KEY } from "./config.js";
import { initBuyerShell, showBuyerToast } from "./buyer-shell.js";
import { nameWithVerifiedBadge } from "./verified-badge.js";
import { fetchOrdersForBuyer } from "./api/orders.js";
import {
  preferredProvider,
  startPaystackCheckout,
  startStripeCheckout,
  verifyPaystack,
  verifyStripe,
} from "./payments.js";
import { t } from "./i18n/index.js";

/* ─── STATE ─── */
let currentUser = null;
let allOrders = [];
let activeFilter = "all";
let paymentInProgress = false;
let selectedStars = 0;
let selectedShopperId = null;
let selectedShopperName = null;

/* ─── STATUS CONFIG ─── */
const statusConfig = {
    pending: { label: "Request Sent", class: "status-pending", step: 0 },
    quoted: { label: "Quote Received", class: "status-accepted", step: 1 },
    accepted: { label: "Accepted", class: "status-accepted", step: 2 },
    paid: { label: "Paid", class: "status-paid", step: 3 },
    purchased: { label: "Purchased", class: "status-purchased", step: 4 },
    delivering: { label: "In Transit", class: "status-delivering", step: 5 },
    delivered: { label: "Delivered", class: "status-delivered", step: 6 },
    cancelled: { label: "Cancelled", class: "status-cancelled", step: -1 }
};

const progressSteps = ["Sent", "Quote", "Accepted", "Paid", "Purchased", "In Transit", "Delivered"];

function hasPaystack() {
    return PAYSTACK_PUBLIC_KEY && !PAYSTACK_PUBLIC_KEY.includes("your_");
}

function hasStripe() {
    return STRIPE_PUBLISHABLE_KEY && STRIPE_PUBLISHABLE_KEY.startsWith("pk_");
}

function renderPaymentButtons(order, total) {
    if (order.status !== "accepted") return "";

    const currency = order.currency || "NGN";
    const primary = preferredProvider(currency);
    const paystackBtn = `
        <button type="button" class="btn-pill ${primary === "paystack" ? "btn-pill--amber" : "btn-pill--secondary"}"
            onclick="makePayment('${order.id}', '${(order.shopper_name || "").replace(/'/g, "\\'")}', ${total}, '${currency}')">
            <i class="fas fa-credit-card"></i> ${t("orders.payPaystack", "Pay with Paystack")}
        </button>`;
    const stripeBtn = `
        <button type="button" class="btn-pill ${primary === "stripe" ? "btn-pill--amber" : "btn-pill--secondary"}"
            onclick="makeStripePayment('${order.id}')">
            <i class="fab fa-stripe"></i> ${t("orders.payStripe", "Pay with card")}
        </button>`;

    if (primary === "paystack" && hasPaystack()) {
        return paystackBtn + (hasStripe() ? stripeBtn : "");
    }
    if (hasStripe()) {
        return stripeBtn + (hasPaystack() ? paystackBtn : "");
    }
    if (hasPaystack()) return paystackBtn;
    return "";
}

function renderShipmentStrip(order) {
    if (!["delivering", "delivered"].includes(order.status)) return "";
    if (!order.tracking_number && !order.carrier) return "";

    const carrier = order.carrier || "Carrier";
    const tracking = order.tracking_number || "—";
    return `
        <div class="order-shipment-strip">
            <i class="fas fa-truck" aria-hidden="true"></i>
            <span><strong>${carrier}</strong> · ${tracking}</span>
        </div>`;
}

/* ─── AUTH + INIT ─── */
function buyerUid() {
    return currentUser?.uid || currentUser?.id || null;
}

async function init() {
    const profile = await initBuyerShell("orders", { title: "My Orders" });
    if (!profile) return;
    currentUser = profile;

    if (!buyerUid()) {
        console.error("My Orders: missing buyer uid on profile", profile);
        showBuyerToast("Could not load your account. Try signing in again.");
        return;
    }

    await loadOrders();

    const params = new URLSearchParams(window.location.search);
    if (params.get("stripe_success") === "1") {
        const orderId = params.get("order_id");
        const sessionId = params.get("session_id");
        if (orderId && sessionId) {
            document.getElementById("processingOverlay")?.classList.add("show");
            try {
                await verifyStripe(orderId, sessionId);
                showSuccessBanner();
            } catch (e) {
                console.error(e);
                showBuyerToast("Payment verification failed — contact support");
            }
            document.getElementById("processingOverlay")?.classList.remove("show");
            history.replaceState({}, "", "my-orders.html");
            await loadOrders();
        }
    }

    document.addEventListener("bfm-order-updated", e => {
        const updated = e.detail;
        if (!updated?.id) return;
        const idx = allOrders.findIndex(o => o.id === updated.id);
        if (idx !== -1) allOrders[idx] = updated;
        else allOrders.unshift(updated);
        renderOrders();
    });
}

document.addEventListener("DOMContentLoaded", init);

/* ─── LOAD ORDERS ─── */
async function loadOrders() {
    try {
        allOrders = await fetchOrdersForBuyer(buyerUid());
    } catch (err) {
        console.error("Load orders error:", err);
        allOrders = [];
    }
    renderOrders();
}
window.loadOrders = loadOrders;

/* ─── FILTER ─── */
window.filterOrders = function (filter, btn) {
    activeFilter = filter;
    document.querySelectorAll(".chip-pill, .filter-tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    renderOrders();
};

/* ─── RENDER ─── */
function renderOrders() {
    const filtered = activeFilter === "all"
        ? allOrders
        : allOrders.filter(o => {
            if (activeFilter === "active")
                return ["accepted", "paid", "purchased", "delivering"].includes(o.status);
            return o.status === activeFilter;
        });

    const list = document.getElementById("ordersList");
    const meta = document.getElementById("ordersMeta");
    if (!list) return;
    if (meta) meta.textContent = `${filtered.length} order${filtered.length !== 1 ? "s" : ""}`;

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="buyer-empty">
                <div class="buyer-empty__icon"><i class="fas fa-box-open"></i></div>
                <h3>No orders here</h3>
                <p>You don't have any orders in this category yet.</p>
                <a href="buyers.html" class="btn-pill btn-pill--primary"><i class="fas fa-search"></i> Browse shoppers</a>
            </div>`;
        return;
    }

    list.innerHTML = filtered.map(order => buildOrderCard(order)).join("");
}

function buildOrderCard(order) {
    const config = statusConfig[order.status] || statusConfig.pending;
    const stepIdx = config.step;
    const total = order.total_amount ? order.total_amount : order.budget * 1.15;
    const isQuoted = order.status === "quoted";
    const isDelivered = order.status === "delivered";
    const quoteNote = isQuoted && order.quote_notes
        ? `<p class="order-quote-note"><i class="fas fa-file-invoice"></i> ${order.quote_notes}</p>` : "";

    const progressHTML = order.status !== "cancelled" ? `
        <div class="order-progress">
            <div class="progress-steps">
                ${progressSteps.map((label, i) => {
        let cls = "";
        if (i < stepIdx) cls = "done";
        if (i === stepIdx) cls = "active";
        return `
                    <div class="progress-step ${cls}">
                        <div class="step-dot">${i < stepIdx ? '<i class="fas fa-check" style="font-size:0.55rem"></i>' : i + 1}</div>
                        <span class="step-label">${label}</span>
                    </div>`;
    }).join("")}
            </div>
        </div>` : "";

    return `
        <div class="order-card">
            <div class="order-top">
                <div>
                    <div class="order-product">${order.product_name}</div>
                    <div class="order-meta">
                        <span><i class="fas fa-user"></i> ${order.shopper_name || "—"}</span>
                        <span><i class="fas fa-dollar-sign"></i> Total: ${order.currency || "₦"}${parseFloat(total).toFixed(2)}</span>
                    </div>
                </div>
                <span class="status-chip ${config.class}">${config.label}</span>
            </div>
            ${progressHTML}
            ${quoteNote}
            ${renderShipmentStrip(order)}
            <div class="order-actions">
                ${isQuoted ? `
                    <button type="button" class="btn-pill btn-pill--primary" onclick="acceptQuote('${order.id}')">
                        <i class="fas fa-check"></i> Accept quote
                    </button>
                    <button type="button" class="btn-pill btn-pill--secondary" onclick="rejectQuote('${order.id}')">
                        Decline
                    </button>` : ""}
                ${renderPaymentButtons(order, total)}
                ${isDelivered ? `
                    <button type="button" class="btn-pill btn-pill--secondary" onclick="leaveReview('${order.shopper_id}', '${order.shopper_name}')">
                        <i class="fas fa-star"></i> Leave review
                    </button>` : ""}
                <a href="tracking.html?order_id=${order.id}" class="btn-pill btn-pill--secondary">
                    <i class="fas fa-location-dot"></i> ${t("orders.track", "Track order")}
                </a>
                <span class="order-date">${new Date(order.created_at).toLocaleDateString()}</span>
            </div>
        </div>`;
}

/* ─── QUOTES ─── */
window.acceptQuote = async function (orderId) {
    const { error } = await supabase.from("requests").update({ status: "accepted" }).eq("id", orderId);
    if (error) { showBuyerToast("Could not accept quote"); return; }
    showBuyerToast("Quote accepted — you can pay when ready");
    await loadOrders();
};

window.rejectQuote = async function (orderId) {
    if (!confirm("Decline this quote?")) return;
    const { error } = await supabase.from("requests").update({ status: "cancelled" }).eq("id", orderId);
    if (error) { showBuyerToast("Could not decline quote"); return; }
    await loadOrders();
};

/* ─── PAYMENTS ─── */
window.makePayment = function (orderId, shopperName, totalAmount, orderCurrency) {
    if (paymentInProgress) return;
    paymentInProgress = true;

    startPaystackCheckout({
        orderId,
        email: currentUser.email,
        totalAmount,
        currency: orderCurrency,
        onSuccess: (reference) => {
            document.getElementById("processingOverlay").classList.add("show");
            handlePaymentSuccess(orderId, reference);
        },
        onClose: () => { paymentInProgress = false; },
    });
};

window.makeStripePayment = async function (orderId) {
    if (paymentInProgress) return;
    paymentInProgress = true;
    try {
        await startStripeCheckout(orderId);
    } catch (e) {
        console.error(e);
        showBuyerToast("Stripe checkout unavailable — use Paystack or configure STRIPE_SECRET_KEY");
        paymentInProgress = false;
    }
};

async function handlePaymentSuccess(orderId, reference) {
    try {
        await verifyPaystack(orderId, reference);

        document.getElementById("processingOverlay").classList.remove("show");
        paymentInProgress = false;
        showSuccessBanner();
    } catch (err) {
        console.error("Unexpected payment update error:", err);
        document.getElementById("processingOverlay").classList.remove("show");
        paymentInProgress = false;
        alert("Payment received but something went wrong. Contact support with ref: " + reference);
    }
}

function showSuccessBanner() {
    const old = document.getElementById("successBanner");
    if (old) old.remove();

    const banner = document.createElement("div");
    banner.id = "successBanner";
    banner.style.cssText = `
        position:fixed;top:70px;left:50%;transform:translateX(-50%);
        background:#1a9e6e;color:white;padding:14px 28px;border-radius:10px;
        font-size:0.9rem;font-weight:600;font-family:'Sora',sans-serif;
        z-index:3000;box-shadow:0 4px 20px rgba(26,158,110,0.35);
        display:flex;align-items:center;gap:10px;animation:slideDown 0.3s ease;
    `;
    banner.innerHTML = `<i class="fas fa-check-circle"></i> Payment confirmed! Your shopper has been notified.`;
    document.body.appendChild(banner);

    setTimeout(() => {
        banner.style.transition = "opacity 0.4s";
        banner.style.opacity = "0";
        setTimeout(() => banner.remove(), 400);
    }, 4000);
}

/* ─── REVIEW MODAL ─── */
window.leaveReview = function (shopperId, shopperName) {
    selectedShopperId = shopperId;
    selectedShopperName = shopperName;
    selectedStars = 0;
    document.getElementById("reviewShopperName").textContent = shopperName;
    document.getElementById("reviewText").value = "";
    document.getElementById("reviewError").style.display = "none";
    document.getElementById("reviewModal").classList.add("open");
    setStars(0);
};

window.closeReviewModal = function () {
    document.getElementById("reviewModal").classList.remove("open");
};

window.setStars = function (n) {
    selectedStars = n;
    document.querySelectorAll("#starPicker span").forEach((s, i) => {
        s.classList.toggle("on", i < n);
    });
};

window.submitReview = async function () {
    const text = document.getElementById("reviewText").value.trim();
    const btn = document.getElementById("reviewSubmitBtn");
    const err = document.getElementById("reviewError");

    if (selectedStars === 0 || !text) {
        err.textContent = "Please provide a star rating and a review.";
        err.style.display = "block";
        return;
    }

    btn.disabled = true;
    btn.textContent = "Submitting...";

    const { error } = await supabase.from("reviews").insert({
        shopper_id: selectedShopperId,
        buyer_id: buyerUid(),
        buyer_name: currentUser.name,
        stars: selectedStars,
        text: text
    });

    if (error) {
        alert("Review failed. Please try again.");
        btn.disabled = false;
        btn.textContent = "Submit Review";
    } else {
        alert("✅ Review submitted! Thank you.");
        window.closeReviewModal();
        btn.disabled = false;
        btn.textContent = "Submit Review";
    }
};

