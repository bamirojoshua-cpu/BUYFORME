import { supabase } from "../supabase.js";
import { cacheFetch, cacheInvalidate, CacheTTL } from "../app-cache.js";

export async function fetchCart(buyerId, opts = {}) {
  return cacheFetch(
    `cart:${buyerId}`,
    CacheTTL.CART,
    async () => {
      const { data, error } = await supabase
        .from("cart_items")
        .select("*")
        .eq("buyer_id", buyerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    opts
  );
}

export async function addToCart(buyerId, item) {
  const { data, error } = await supabase
    .from("cart_items")
    .insert({ buyer_id: buyerId, ...item })
    .select()
    .single();
  if (error) throw error;
  cacheInvalidate(`cart:${buyerId}`);
  return data;
}

export async function updateCartItem(id, patch, buyerId) {
  const { error } = await supabase.from("cart_items").update(patch).eq("id", id);
  if (error) throw error;
  if (buyerId) cacheInvalidate(`cart:${buyerId}`);
}

export async function removeFromCart(id, buyerId) {
  const { error } = await supabase.from("cart_items").delete().eq("id", id);
  if (error) throw error;
  if (buyerId) cacheInvalidate(`cart:${buyerId}`);
}

export async function clearCart(buyerId, shopperId = null) {
  let q = supabase.from("cart_items").delete().eq("buyer_id", buyerId);
  if (shopperId) q = q.eq("shopper_id", shopperId);
  const { error } = await q;
  if (error) throw error;
  cacheInvalidate(`cart:${buyerId}`);
}

export async function cartCount(buyerId) {
  const { count, error } = await supabase
    .from("cart_items")
    .select("*", { count: "exact", head: true })
    .eq("buyer_id", buyerId);
  if (error) return 0;
  return count || 0;
}

/** Group cart items by shopper_id */
export function groupCartByShopper(items) {
  /** @type {Map<string, object[]>} */
  const map = new Map();
  for (const item of items) {
    const key = String(item.shopper_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}
