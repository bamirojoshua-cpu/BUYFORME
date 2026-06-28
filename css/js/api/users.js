/**
 * BuyForMe — Users API
 */

import { supabase } from "../supabase.js";
import { cacheFetch, cacheInvalidate, CacheTTL } from "../app-cache.js";

/** @param {string} uid */
export async function fetchPublicShopper(uid, opts = {}) {
  if (!uid) return null;
  return cacheFetch(
    `shopper:${uid}`,
    CacheTTL.SHOPPER,
    async () => {
      const { data, error } = await supabase
        .from("public_shoppers")
        .select("*")
        .eq("uid", uid)
        .maybeSingle();
      if (error) throw new Error(error.message || "Could not load shopper.");
      return data;
    },
    opts
  );
}

/** @param {string} uid */
export async function fetchPublicShopperBasic(uid) {
  const data = await fetchPublicShopper(uid);
  if (!data) return null;
  return {
    name: data.name,
    avatar_url: data.avatar_url,
    location: data.location,
    rating: data.rating,
    review_count: data.review_count,
    fee: data.fee,
    response_time: data.response_time,
  };
}

/** @returns {Promise<object[]>} */
export async function fetchAllPublicShoppers(opts = {}) {
  return cacheFetch(
    "shoppers:all",
    CacheTTL.SHOPPERS,
    async () => {
      const { data, error } = await supabase.from("public_shoppers").select("*");
      if (error) throw new Error(error.message || "Could not load shoppers.");
      return data || [];
    },
    opts
  );
}

export function invalidateShoppersCache() {
  cacheInvalidate("shoppers:all");
}
