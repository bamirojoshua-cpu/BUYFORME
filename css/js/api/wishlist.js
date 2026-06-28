import { supabase } from "../supabase.js";
import { cacheFetch, cacheInvalidate, CacheTTL } from "../app-cache.js";

export async function fetchWishlist(buyerId, opts = {}) {
  return cacheFetch(
    `wishlist:${buyerId}`,
    CacheTTL.WISHLIST,
    async () => {
      const { data, error } = await supabase
        .from("wishlist_items")
        .select("*")
        .eq("buyer_id", buyerId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message || "Could not load wishlist.");
      return data || [];
    },
    opts
  );
}

export async function addToWishlist(buyerId, item) {
  const { data, error } = await supabase
    .from("wishlist_items")
    .insert({ buyer_id: buyerId, ...item })
    .select()
    .single();
  if (error) throw new Error(error.message || "Could not update wishlist.");
  cacheInvalidate(`wishlist:${buyerId}`);
  return data;
}

export async function removeFromWishlist(id, buyerId) {
  const { error } = await supabase.from("wishlist_items").delete().eq("id", id);
  if (error) throw new Error(error.message || "Could not update wishlist.");
  if (buyerId) cacheInvalidate(`wishlist:${buyerId}`);
}

export async function wishlistCount(buyerId) {
  const { count, error } = await supabase
    .from("wishlist_items")
    .select("*", { count: "exact", head: true })
    .eq("buyer_id", buyerId);
  if (error) return 0;
  return count || 0;
}
