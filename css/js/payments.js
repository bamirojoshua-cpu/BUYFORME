/**
 * BuyForMe — unified payment routing (Paystack + Stripe)
 */

import { supabase } from "./supabase.js";
import { PAYSTACK_PUBLIC_KEY, STRIPE_PUBLISHABLE_KEY } from "./config.js";

export const PAYSTACK_CURRENCIES = new Set(["NGN", "GHS", "ZAR", "USD", "KES"]);

/** Prefer Paystack for African currencies when key is set */
export function preferredProvider(currency) {
  const c = String(currency || "USD").toUpperCase();
  if (["NGN", "GHS", "KES"].includes(c) && PAYSTACK_PUBLIC_KEY && !PAYSTACK_PUBLIC_KEY.includes("your_")) {
    return "paystack";
  }
  if (STRIPE_PUBLISHABLE_KEY && !STRIPE_PUBLISHABLE_KEY.includes("your_")) {
    return "stripe";
  }
  return "paystack";
}

export async function startStripeCheckout(orderId) {
  const { data, error } = await supabase.functions.invoke("create_stripe_checkout", {
    body: { order_id: orderId },
  });
  if (error) throw error;
  if (!data?.url) throw new Error(data?.error || "No checkout URL");
  window.location.href = data.url;
}

export function startPaystackCheckout({ orderId, email, totalAmount, currency, onSuccess, onClose }) {
  if (typeof PaystackPop === "undefined") {
    throw new Error("Paystack script not loaded");
  }
  const payCurrency = PAYSTACK_CURRENCIES.has(String(currency || "").toUpperCase())
    ? String(currency).toUpperCase()
    : "NGN";

  const handler = PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email,
    amount: Math.round(totalAmount * 100),
    currency: payCurrency,
    ref: "BFM_" + orderId + "_" + Date.now(),
    callback: (response) => onSuccess(response.reference),
    onClose,
  });
  handler.openIframe();
}

export async function verifyPaystack(orderId, reference) {
  const { data, error } = await supabase.functions.invoke("verify_paystack_payment", {
    body: { order_id: orderId, reference },
  });
  if (error) throw error;
  return data;
}

export async function verifyStripe(orderId, sessionId) {
  const { data, error } = await supabase.functions.invoke("verify_stripe_session", {
    body: { order_id: orderId, session_id: sessionId },
  });
  if (error) throw error;
  return data;
}
