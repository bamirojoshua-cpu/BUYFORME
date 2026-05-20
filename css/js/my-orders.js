import { supabase } from "./supabase.js";
import { PAYSTACK_PUBLIC_KEY } from "./config.js";
import { initBuyerShell, showBuyerToast } from "./buyer-shell.js";
import { nameWithVerifiedBadge } from "./verified-badge.js";

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
    accepted: { label: "Accepted", class: "status-accepted", step: 1 },
    paid: { label: "Paid", class: "status-paid", step: 2 },
    purchased: { label: "Purchased", class: "status-purchased", step: 3 },
    delivering: { label: "In Transit", class: "status-delivering", step: 4 },
    delivered: { label: "Delivered", class: "status-delivered", step: 5 },
    cancelled: { label: "Cancelled", class: "status-cancelled", step: -1 }
};

const progressSteps = ["Request Sent", "Accepted", "Paid", "Purchased", "In Transit", "Delivered"];

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
    const { data, error } = await supabase
        .from("requests").select("*")
        .eq("buyer_id", buyerUid())
        .order("created_at", { ascending: false });

    if (error) { console.error("Load orders error:", error); allOrders = []; }
    else { allOrders = data || []; }
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
    const canPay = order.status === "accepted";
    const isDelivered = order.status === "delivered";

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
            <div class="order-actions">
                ${canPay ? `
                    <button type="button" class="btn-pill btn-pill--amber" onclick="makePayment('${order.id}', '${order.shopper_name}', ${total})">
                        <i class="fas fa-credit-card"></i> Pay now
                    </button>` : ""}
                ${isDelivered ? `
                    <button type="button" class="btn-pill btn-pill--secondary" onclick="leaveReview('${order.shopper_id}', '${order.shopper_name}')">
                        <i class="fas fa-star"></i> Leave review
                    </button>` : ""}
                <span class="order-date">${new Date(order.created_at).toLocaleDateString()}</span>
            </div>
        </div>`;
}

/* ─── PAYSTACK ─── */
window.makePayment = function (orderId, shopperName, totalAmount) {
    if (paymentInProgress) return;
    paymentInProgress = true;

    var handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: currentUser.email,
        amount: Math.round(totalAmount * 100),
        currency: "NGN",
        ref: "BFM_" + orderId + "_" + Date.now(),

        callback: function (response) {
            document.getElementById("processingOverlay").classList.add("show");
            handlePaymentSuccess(orderId, response.reference);
        },

        onClose: function () {
            paymentInProgress = false;
        }
    });

    handler.openIframe();
};

async function handlePaymentSuccess(orderId, reference) {
    try {
        const { data, error } = await supabase.functions.invoke("verify_paystack_payment", {
            body: { order_id: orderId, reference }
        });

        document.getElementById("processingOverlay").classList.remove("show");
        paymentInProgress = false;

        if (error) {
            console.error("Payment verify function error:", error);
            alert(
                "Payment received but could not be verified on the server yet.\n\n" +
                "Please contact support with ref: " + reference
            );
        } else {
            showSuccessBanner();
            // Realtime will re-render the card automatically
        }
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

