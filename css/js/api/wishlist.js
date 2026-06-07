import { supabase } from "../supabase.js";

export async function fetchWishlist(buyerId) {
  const { data, error } = await supabase
    .from("wishlist_items")
    .select("*")
    .eq("buyer_id", buyerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addToWishlist(buyerId, item) {
  const { data, error } = await supabase
    .from("wishlist_items")
    .insert({ buyer_id: buyerId, ...item })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeFromWishlist(id) {
  const { error } = await supabase.from("wishlist_items").delete().eq("id", id);
  if (error) throw error;
}

export async function wishlistCount(buyerId) {
  const { count, error } = await supabase
    .from("wishlist_items")
    .select("*", { count: "exact", head: true })
    .eq("buyer_id", buyerId);
  if (error) return 0;
  return count || 0;
}
