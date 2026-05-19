/* Buyer auth + shopper directory helpers (profile, request, chat) */

import { supabase } from "./supabase.js";
import { getShopperDashboardHref } from "./app-paths.js";

export async function requireBuyerSession() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    console.error("Session error:", sessionError);
    throw new Error(sessionError.message || "Could not verify your session.");
  }
  if (!session) {
    window.location.assign("auth.html");
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("*")
    .eq("uid", session.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Profile error:", profileError);
    throw new Error(profileError.message || "Could not load your account.");
  }
  if (!profile) {
    window.location.assign("auth.html");
    return null;
  }

  const role = String(profile.role || "").toLowerCase();
  if (role === "shopper") {
    if (profile.verification_status?.toLowerCase() === "approved") {
      window.location.assign(getShopperDashboardHref());
    } else {
      window.location.assign("verify.html");
    }
    return null;
  }

  return { session, profile };
}

export async function fetchPublicShopper(uid) {
  if (!uid) return null;

  const { data, error } = await supabase
    .from("public_shoppers")
    .select("*")
    .eq("uid", uid)
    .maybeSingle();

  if (error) {
    console.error("public_shoppers error:", error);
    throw new Error(error.message || "Could not load shopper profile.");
  }
  return data;
}
