// Verifies Stripe Checkout session and marks order paid.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY

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
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing Supabase env" });
  if (!STRIPE_SECRET_KEY) return json(500, { error: "Missing STRIPE_SECRET_KEY" });

  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "Missing Authorization" });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: authData, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !authData?.user) return json(401, { error: "Invalid token" });

  const { order_id, session_id } = await req.json().catch(() => ({}));
  if (!order_id || !session_id) return json(400, { error: "Missing order_id or session_id" });

  const { data: order, error: orderErr } = await supabase
    .from("requests")
    .select("*")
    .eq("id", order_id)
    .maybeSingle();
  if (orderErr || !order) return json(404, { error: "Order not found" });
  if (String(order.buyer_id) !== String(authData.user.id)) return json(403, { error: "Not your order" });
  if (order.status === "paid") return json(200, { ok: true, already_paid: true });

  const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const session = await stripeRes.json().catch(() => null);
  if (!stripeRes.ok || !session) return json(400, { error: "Invalid Stripe session" });

  if (session.payment_status !== "paid") {
    return json(400, { error: `Payment not completed: ${session.payment_status}` });
  }
  if (String(session.metadata?.order_id || session.client_reference_id) !== String(order_id)) {
    return json(400, { error: "Session order mismatch" });
  }

  const expected = Math.round(Number(order.total_amount || 0) * 100);
  if (Number(session.amount_total) !== expected) {
    return json(400, { error: "Amount mismatch" });
  }

  const { error: updErr } = await supabase
    .from("requests")
    .update({
      status: "paid",
      payment_reference: String(session.payment_intent || session_id),
      payment_provider: "stripe",
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", order_id);
  if (updErr) return json(500, { error: "Failed to update order", details: updErr });

  return json(200, { ok: true });
});
