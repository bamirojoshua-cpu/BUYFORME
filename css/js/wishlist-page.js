import { initBuyerShell, showBuyerToast } from "./buyer-shell.js";
import { fetchWishlist, removeFromWishlist } from "./api/wishlist.js";
import { addToCart } from "./api/cart.js";
import { escapeHtml } from "./ui/index.js";

let currentUser = null;

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

async function load() {
  const grid = document.getElementById("wishlistGrid");
  try {
    const items = await fetchWishlist(currentUser.uid);
    if (!items.length) {
      grid.innerHTML = `
        <div class="wc-empty buyer-card" style="grid-column:1/-1">
          <i class="fas fa-heart"></i>
          <h3>Your wishlist is empty</h3>
          <p>Save products while browsing shoppers or sending requests.</p>
          <a href="buyers.html" class="bfm-btn bfm-btn--primary" style="margin-top:16px">Discover shoppers</a>
        </div>`;
      return;
    }

    grid.innerHTML = items.map((item) => `
      <article class="wc-card">
        <div class="wc-card__title">${escapeHtml(item.product_name)}</div>
        <div class="wc-card__meta">
          ${item.store_name ? escapeHtml(item.store_name) + " · " : ""}
          ${item.budget ? `${item.currency || "USD"} ${item.budget}` : "No budget set"}
        </div>
        ${item.notes ? `<p class="wc-card__meta">${escapeHtml(item.notes)}</p>` : ""}
        <div class="wc-card__actions">
          ${item.shopper_id ? `<a href="request.html?id=${encodeURIComponent(item.shopper_id)}&wishlist=${encodeURIComponent(item.id)}" class="bfm-btn bfm-btn--primary bfm-btn--sm">Request</a>` : `<a href="buyers.html" class="bfm-btn bfm-btn--secondary bfm-btn--sm">Pick shopper</a>`}
          <button type="button" class="bfm-btn bfm-btn--secondary bfm-btn--sm" data-cart="${escapeAttr(item.id)}">Add to cart</button>
          <button type="button" class="bfm-btn bfm-btn--ghost bfm-btn--sm" data-remove="${escapeAttr(item.id)}">Remove</button>
        </div>
      </article>`).join("");

    grid.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await removeFromWishlist(btn.dataset.remove);
        showBuyerToast("Removed from wishlist");
        load();
        document.dispatchEvent(new CustomEvent("bfm-buyer-badges"));
      });
    });

    grid.querySelectorAll("[data-cart]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const item = items.find((i) => i.id === btn.dataset.cart);
        if (!item?.shopper_id) {
          showBuyerToast("Choose a shopper first — open Request or pick from Discover");
          return;
        }
        await addToCart(currentUser.uid, {
          shopper_id: item.shopper_id,
          product_name: item.product_name,
          store_name: item.store_name,
          quantity: item.quantity || 1,
          category: item.category,
          notes: item.notes,
          budget: item.budget,
          currency: item.currency,
        });
        showBuyerToast("Added to cart");
        document.dispatchEvent(new CustomEvent("bfm-buyer-badges"));
      });
    });
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div class="wc-empty"><p>Could not load wishlist. Run supabase-phase3.sql if tables are missing.</p></div>`;
  }
}

async function init() {
  const profile = await initBuyerShell("wishlist", { title: "Wishlist" });
  if (!profile) return;
  currentUser = profile;
  await load();

  const params = new URLSearchParams(location.search);
  if (params.get("wishlist") === "added") showBuyerToast("Saved to wishlist");
}

document.addEventListener("DOMContentLoaded", init);
