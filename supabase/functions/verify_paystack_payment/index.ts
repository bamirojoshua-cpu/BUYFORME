// Supabase Edge Function: verify_paystack_payment
// Verifies a Paystack transaction and, if valid, marks the request as paid.
//
// Env vars required:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - PAYSTACK_SECRET_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

function getBearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing Supabase env" });
  if (!PAYSTACK_SECRET_KEY) return json(500, { error: "Missing PAYSTACK_SECRET_KEY" });

  const jwt = getBearer(req);
  if (!jwt) return json(401, { error: "Missing Authorization bearer token" });

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Identify caller (buyer) via JWT
  const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(jwt);
  if (authErr || !authData?.user) return json(401, { error: "Invalid token" });
  const callerUid = authData.user.id;

  const { order_id, reference } = await req.json().catch(() => ({}));
  if (!order_id || !reference) return json(400, { error: "Missing order_id or reference" });

  // Load order
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("requests")
    .select("*")
    .eq("id", order_id)
    .maybeSingle();
  if (orderErr || !order) return json(404, { error: "Order not found" });

  // Ensure caller is the buyer
  if (String(order.buyer_id) !== String(callerUid)) return json(403, { error: "Not your order" });

  // Only allow payment verification from accepted state
  if (!["accepted", "payment"].includes(String(order.status))) {
    return json(409, { error: `Order not payable in status: ${order.status}` });
  }

  // Compute expected amount (kobo) and currency
  const currency = String(order.currency || "NGN");
  const expectedTotal = Number(order.total_amount ?? 0);
  if (!Number.isFinite(expectedTotal) || expectedTotal <= 0) {
    return json(400, { error: "Order has invalid total_amount" });
  }
  const expectedAmount = Math.round(expectedTotal * 100);

  // Verify transaction with Paystack
  const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "content-type": "application/json",
    },
  });

  const paystackJson = await paystackRes.json().catch(() => null) as any;
  if (!paystackRes.ok || !paystackJson?.data) {
    return json(400, { error: "Paystack verification failed", details: paystackJson });
  }

  const data = paystackJson.data;
  const status = String(data.status || "");
  const paidAmount = Number(data.amount);
  const paidCurrency = String(data.currency || "");

  if (status !== "success") return json(400, { error: `Payment not successful: ${status}` });
  if (paidCurrency && paidCurrency !== currency) {
    return json(400, { error: `Currency mismatch: expected ${currency}, got ${paidCurrency}` });
  }
  if (paidAmount !== expectedAmount) {
    return json(400, { error: `Amount mismatch: expected ${expectedAmount}, got ${paidAmount}` });
  }

  // Mark paid
  const { error: updErr } = await supabaseAdmin
    .from("requests")
    .update({
      status: "paid",
      payment_reference: reference,
      payment_provider: "paystack",
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", order_id);
  if (updErr) return json(500, { error: "Failed to update order", details: updErr });

  return json(200, { ok: true });
});

