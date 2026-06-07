/**
 * BuyForMe — Orders API
 * Single source of truth for order status, fetching, and realtime.
 */

import { supabase } from "../supabase.js";
import { fetchPublicShopperBasic } from "./users.js";

/* ─── Status constants ─── */

export const ORDER_STATUS_ORDER = [
  "pending", "quoted", "accepted", "paid", "purchased", "delivering", "delivered",
];

/** 1-indexed step for progress UI (7 steps incl. quote) */
export const ORDER_STATUS_STEP = {
  pending:    1,
  quoted:     2,
  accepted:   3,
  payment:    3,
  paid:       4,
  purchased:  5,
  delivering: 6,
  delivered:  7,
};

export const ORDER_STATUS_EVENTS = {
  pending:    "Order sent to shopper",
  quoted:     "Shopper sent you a quote",
  accepted:   "Shopper accepted your order",
  payment:    "Awaiting your payment",
  paid:       "Payment confirmed",
  purchased:  "Shopper bought the item",
  delivering: "Item is on its way to you",
  delivered:  "Order delivered! 🎉",
};

export const ORDER_STATUS_LABELS = {
  pending:    "Request Sent",
  quoted:     "Quote Received",
  accepted:   "Accepted",
  payment:    "Awaiting Payment",
  paid:       "Paid",
  purchased:  "Purchased",
  delivering: "In Transit",
  delivered:  "Delivered",
  cancelled:  "Cancelled",
};

export const ORDER_BADGE_CLASS = {
  pending:    "bfm-badge--pending",
  quoted:     "bfm-badge--payment",
  accepted:   "bfm-badge--accepted",
  payment:    "bfm-badge--payment",
  paid:       "bfm-badge--paid",
  purchased:  "bfm-badge--purchased",
  delivering: "bfm-badge--delivering",
  delivered:  "bfm-badge--delivered",
};

/* ─── Formatting ─── */

/** @param {string} id */
export function formatOrderRef(id) {
  if (!id) return "N/A";
  return `Order #BFM-${String(id).slice(0, 8).toUpperCase()}`;
}

/** @param {object} order */
export function getOrderTotal(order) {
  if (order?.total_amount) return Number(order.total_amount);
  if (order?.budget) return Number(order.budget) * 1.15;
  return 0;
}

/* ─── Queries ─── */

/** @param {string} orderId */
export async function fetchOrderById(orderId) {
  const { data, error } = await supabase
    .from("requests")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw new Error(error.message || "Could not load order.");
  return data;
}

/** @param {string} buyerId */
export async function fetchOrdersForBuyer(buyerId) {
  const { data, error } = await supabase
    .from("requests")
    .select("*")
    .eq("buyer_id", buyerId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message || "Could not load orders.");
  return data || [];
}

/**
 * Fetch order with shopper profile attached.
 * @param {string} orderId
 */
export async function fetchOrderWithShopper(orderId) {
  const order = await fetchOrderById(orderId);
  if (!order) return null;

  if (order.shopper_id) {
    try {
      const shopper = await fetchPublicShopperBasic(order.shopper_id);
      if (shopper) {
        order.shopper_name = shopper.name;
        order.shopper_avatar = shopper.avatar_url;
      }
    } catch {
      /* shopper profile optional */
    }
  }

  return order;
}

/* ─── Realtime ─── */

/**
 * Subscribe to order updates.
 * @param {string} orderId
 * @param {(order: object) => void} onUpdate
 * @returns {import('@supabase/supabase-js').RealtimeChannel}
 */
export function subscribeOrderUpdates(orderId, onUpdate) {
  return supabase
    .channel("order-" + orderId)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "requests",
        filter: `id=eq.${orderId}`,
      },
      (payload) => onUpdate(payload.new)
    )
    .subscribe();
}

/** @param {import('@supabase/supabase-js').RealtimeChannel|null} channel */
export function unsubscribeOrder(channel) {
  if (channel) supabase.removeChannel(channel);
}

/* ─── Timeline helpers ─── */

/** @param {string} status */
export function getTimelineStatuses(status) {
  const lookup = status === "payment" ? "accepted" : status;
  const idx = ORDER_STATUS_ORDER.indexOf(lookup);
  if (idx === -1) return [];
  return ORDER_STATUS_ORDER.slice(0, idx + 1);
}

/** @param {string} status */
export function getProgressStep(status) {
  return ORDER_STATUS_STEP[status] || 1;
}
