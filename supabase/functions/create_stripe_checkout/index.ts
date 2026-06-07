// Creates a Stripe Checkout session for an accepted order.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, SITE_URL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:5173";

  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing Supabase env" });
  if (!STRIPE_SECRET_KEY) return json(500, { error: "Missing STRIPE_SECRET_KEY" });

  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "Missing Authorization" });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: authData, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !authData?.user) return json(401, { error: "Invalid token" });

  const { order_id } = await req.json().catch(() => ({}));
  if (!order_id) return json(400, { error: "Missing order_id" });

  const { data: order, error: orderErr } = await supabase
    .from("requests")
    .select("*")
    .eq("id", order_id)
    .maybeSingle();
  if (orderErr || !order) return json(404, { error: "Order not found" });
  if (String(order.buyer_id) !== String(authData.user.id)) return json(403, { error: "Not your order" });
  if (!["accepted", "payment"].includes(String(order.status))) {
    return json(409, { error: `Order not payable: ${order.status}` });
  }

  const currency = String(order.currency || "USD").toLowerCase();
  const amount = Math.round(Number(order.total_amount || 0) * 100);
  if (!Number.isFinite(amount) || amount <= 0) return json(400, { error: "Invalid total_amount" });

  const successUrl = `${SITE_URL.replace(/\/$/, "")}/my-orders.html?stripe_success=1&order_id=${encodeURIComponent(order_id)}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${SITE_URL.replace(/\/$/, "")}/my-orders.html?stripe_cancel=1`;

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);
  params.set("client_reference_id", String(order_id));
  params.set("customer_email", authData.user.email || "");
  params.set("line_items[0][price_data][currency]", currency);
  params.set("line_items[0][price_data][unit_amount]", String(amount));
  params.set("line_items[0][price_data][product_data][name]", String(order.product_name || "BuyForMe Order"));
  params.set("line_items[0][price_data][product_data][description]", `Order BFM-${String(order_id).slice(0, 8).toUpperCase()}`);
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[order_id]", String(order_id));
  params.set("metadata[buyer_id]", String(authData.user.id));

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const stripeJson = await stripeRes.json().catch(() => null);
  if (!stripeRes.ok || !stripeJson?.url) {
    return json(400, { error: "Stripe session failed", details: stripeJson });
  }

  return json(200, { url: stripeJson.url, session_id: stripeJson.id });
});
