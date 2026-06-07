/**
 * BuyForMe — Session API
 * Centralizes auth session + profile fetching.
 */

import { supabase } from "../supabase.js";

/** @returns {Promise<import('@supabase/supabase-js').Session|null>} */
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * @param {string} uid
 * @param {string} [columns="*"]
 */
export async function fetchUserProfile(uid, columns = "*") {
  const { data, error } = await supabase
    .from("users")
    .select(columns)
    .eq("uid", uid)
    .maybeSingle();

  if (error) throw new Error(error.message || "Could not load profile.");
  return data;
}

/**
 * Returns session user merged with profile, or null if not signed in.
 * @param {string} [columns="*"]
 */
export async function getSessionUser(columns = "*") {
  const session = await getSession();
  if (!session) return null;

  const profile = await fetchUserProfile(session.user.id, columns);
  if (!profile) {
    return {
      id: session.user.id,
      uid: session.user.id,
      email: session.user.email,
    };
  }

  return {
    ...profile,
    id: profile.uid || session.user.id,
    uid: profile.uid || session.user.id,
    email: profile.email || session.user.email,
  };
}
