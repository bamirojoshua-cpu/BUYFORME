import { initBuyerShell, showBuyerToast } from "./buyer-shell.js";
import { fetchCart, removeFromCart, clearCart, groupCartByShopper } from "./api/cart.js";
import { fetchPublicShopperBasic } from "./api/users.js";
import { buildRequestRow, insertRequest, parseShopperFeePercent } from "./api/request-builder.js";
import { escapeHtml } from "./ui/index.js";

let currentUser = null;
let cartItems = [];

async function checkoutShopper(shopperId, items) {
  const shopper = await fetchPublicShopperBasic(shopperId);
  if (!shopper) {
    showBuyerToast("Shopper not found");
    return;
  }
  const feePct = parseShopperFeePercent(shopper.fee);
  const fullShopper = { uid: shopperId, name: shopper.name, location: shopper.location || "" };

  let sent = 0;
  for (const item of items) {
    const row = buildRequestRow({
      buyer: currentUser,
      shopper: fullShopper,
      item: {
        productName: item.product_name,
        storeName: item.store_name,
        quantity: item.quantity,
        category: item.category,
        notes: item.notes,
        budget: item.budget,
        currency: item.currency,
        address: item.address,
        country: item.country,
        phone: item.phone,
        timeline: item.timeline,
      },
      shopperFeePercent: feePct,
    });
    await insertRequest(row);
    sent++;
  }

  await clearCart(currentUser.uid, shopperId);
  showBuyerToast(`${sent} request${sent > 1 ? "s" : ""} sent to ${shopper.name}`);
  document.dispatchEvent(new CustomEvent("bfm-buyer-badges"));
  render();
}

function render() {
  const root = document.getElementById("cartContent");
  if (!cartItems.length) {
    root.innerHTML = `
      <div class="wc-empty buyer-card">
        <i class="fas fa-cart-shopping"></i>
        <h3>Your cart is empty</h3>
        <p>Add items from a request page or your wishlist.</p>
        <a href="buyers.html" class="bfm-btn bfm-btn--primary" style="margin-top:16px">Browse shoppers</a>
      </div>`;
    return;
  }

  const groups = groupCartByShopper(cartItems);
  let html = "";

  for (const [shopperId, items] of groups) {
    const name = items[0].shopper_name || "Shopper";
    const subtotal = items.reduce((s, i) => s + (Number(i.budget) || 0), 0);
    const currency = items[0].currency || "USD";

    html += `
      <section class="wc-shop-group buyer-card buyer-animate-in">
        <div class="wc-shop-group__head">
          <h2><i class="fas fa-user"></i> ${escapeHtml(name)}</h2>
          <span class="wc-item-row__price">${currency} ${subtotal.toFixed(2)} est.</span>
        </div>
        ${items.map((item) => `
          <div class="wc-item-row">
            <div class="wc-item-row__info">
              <h3>${escapeHtml(item.product_name)}</h3>
              <p>Qty ${item.quantity || 1}${item.store_name ? ` · ${escapeHtml(item.store_name)}` : ""}</p>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span class="wc-item-row__price">${item.currency || "USD"} ${Number(item.budget || 0).toFixed(2)}</span>
              <button type="button" class="bfm-btn bfm-btn--ghost bfm-btn--sm" data-remove="${item.id}" aria-label="Remove"><i class="fas fa-trash"></i></button>
            </div>
          </div>`).join("")}
        <div class="wc-checkout-bar">
          <span>${items.length} item${items.length > 1 ? "s" : ""} — pay only after shopper accepts</span>
          <button type="button" class="bfm-btn bfm-btn--primary" data-checkout="${shopperId}">Send requests</button>
        </div>
      </section>`;
  }

  root.innerHTML = html;

  root.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await removeFromCart(btn.dataset.remove, currentUser.uid);
      cartItems = cartItems.filter((i) => i.id !== btn.dataset.remove);
      showBuyerToast("Removed from cart");
      document.dispatchEvent(new CustomEvent("bfm-buyer-badges"));
      render();
    });
  });

  root.querySelectorAll("[data-checkout]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Sending…";
      try {
        const sid = btn.dataset.checkout;
        await checkoutShopper(sid, groups.get(sid) || []);
      } catch (err) {
        console.error(err);
        showBuyerToast("Checkout failed — try again");
        btn.disabled = false;
        btn.textContent = "Send requests";
      }
    });
  });
}

export async function mountCartPage() {
  const profile = await initBuyerShell("cart", { title: "Cart" });
  if (!profile) return;
  currentUser = profile;
  try {
    cartItems = await fetchCart(currentUser.uid, {
      onUpdate: (items) => {
        cartItems = items;
        render();
      },
    });
  } catch {
    cartItems = [];
  }
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  import("./buyer-router.js").then((r) => {
    if (r.shouldAutoMountPage()) mountCartPage();
  });
});
