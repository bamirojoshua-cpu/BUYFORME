/**
 * Buyer auth session helpers + profile cache for fast tab switches.
 */

import { supabase } from "./supabase.js";
import { getShopperDashboardHref } from "./app-paths.js";

const PROFILE_KEY = "bfm-buyer-profile";
const PROFILE_TTL_MS = 5 * 60 * 1000;

export function getCachedBuyerProfile() {
  try {
    const raw = sessionStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const { profile, ts } = JSON.parse(raw);
    if (!profile?.uid || Date.now() - ts > PROFILE_TTL_MS) return null;
    return profile;
  } catch {
    return null;
  }
}

export function setCachedBuyerProfile(profile) {
  if (!profile?.uid) return;
  try {
    sessionStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ profile, ts: Date.now() })
    );
  } catch {
    /* quota */
  }
}

export function clearCachedBuyerProfile() {
  try {
    sessionStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

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

  const cached = getCachedBuyerProfile();
  if (cached?.uid === session.user.id) {
    return { session, profile: cached };
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

  setCachedBuyerProfile(profile);
  return { session, profile };
}

export { fetchPublicShopper } from "./api/users.js";
