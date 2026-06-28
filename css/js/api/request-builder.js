/**
 * BuyForMe — Build & submit request payloads (shared by request.js + cart.js)
 */

import { supabase } from "../supabase.js";
import { invalidateOrdersCache } from "./orders.js";

export const PLATFORM_FEE_PERCENT = 5;

/** @param {number} budget @param {number} shopperFeePercent */
export function computeFees(budget, shopperFeePercent = 10) {
  const b = Number(budget) || 0;
  const shopperFee = b * (shopperFeePercent / 100);
  const platformFee = b * (PLATFORM_FEE_PERCENT / 100);
  return {
    shopperFee: Math.round(shopperFee * 100) / 100,
    platformFee: Math.round(platformFee * 100) / 100,
    total: Math.round((b + shopperFee + platformFee) * 100) / 100,
  };
}

/** Parse shopper fee string like "10%" */
export function parseShopperFeePercent(feeStr) {
  const match = String(feeStr || "").match(/\d+/);
  return match ? parseInt(match[0], 10) : 10;
}

/**
 * @param {object} params
 * @param {object} params.buyer
 * @param {object} params.shopper
 * @param {object} params.item — product fields
 * @param {number} params.shopperFeePercent
 * @param {string} [params.status='pending']
 * @param {string} [params.requestType='purchase']
 */
export function buildRequestRow({ buyer, shopper, item, shopperFeePercent, status = "pending", requestType = "purchase" }) {
  const budget = parseFloat(item.budget) || 0;
  const { shopperFee, platformFee, total } = computeFees(budget, shopperFeePercent);

  return {
    buyer_id: buyer.uid || buyer.id,
    buyer_name: buyer.name,
    shopper_id: shopper.uid || shopper.id,
    shopper_name: shopper.name,
    shopper_location: shopper.location || "",
    product_name: item.productName || item.product_name,
    store_name: item.storeName || item.store_name || "",
    quantity: parseInt(item.quantity, 10) || 1,
    category: item.category || "",
    notes: item.notes || "",
    budget,
    shopper_fee: shopperFee,
    platform_fee: platformFee,
    total_amount: total,
    currency: item.currency || "USD",
    address: item.address || "",
    country: item.country || "",
    phone: item.phone || "",
    timeline: item.timeline || "",
    status,
    request_type: requestType,
  };
}

/** @param {object} row */
export async function insertRequest(row) {
  const { data, error } = await supabase.from("requests").insert(row).select().single();
  if (error) throw new Error(error.message || "Could not send request.");
  if (row?.buyer_id) invalidateOrdersCache(row.buyer_id);
  return data;
}

/** Recalculate totals after quote price change */
export function recalculateFromQuote(budget, shopperFeePercent = 10) {
  return computeFees(budget, shopperFeePercent);
}
