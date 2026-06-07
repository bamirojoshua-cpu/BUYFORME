/**
 * BuyForMe — Users API
 */

import { supabase } from "../supabase.js";

/** @param {string} uid */
export async function fetchPublicShopper(uid) {
  const { data, error } = await supabase
    .from("public_shoppers")
    .select("*")
    .eq("uid", uid)
    .maybeSingle();

  if (error) throw new Error(error.message || "Could not load shopper.");
  return data;
}

/** @param {string} uid */
export async function fetchPublicShopperBasic(uid) {
  const { data, error } = await supabase
    .from("public_shoppers")
    .select("name, avatar_url, location, rating, review_count, fee, response_time")
    .eq("uid", uid)
    .maybeSingle();

  if (error) throw new Error(error.message || "Could not load shopper.");
  return data;
}

/** @returns {Promise<object[]>} */
export async function fetchAllPublicShoppers() {
  const { data, error } = await supabase.from("public_shoppers").select("*");
  if (error) throw new Error(error.message || "Could not load shoppers.");
  return data || [];
}
