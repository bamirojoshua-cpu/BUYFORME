/* Shared sign-out — clears Supabase session and all persisted auth keys */

/**
 * Remove BuyForMe / Supabase auth keys from browser storage.
 */
export function wipeAuthStorage() {
  const shouldRemove = (key) =>
    key === "bfm-auth" ||
    key.startsWith("bfm-auth") ||
    /^sb-.+-auth-token/.test(key);

  try {
    for (const store of [localStorage, sessionStorage]) {
      Object.keys(store).forEach((key) => {
        if (shouldRemove(key)) store.removeItem(key);
      });
    }
  } catch {
    /* ignore */
  }
}

/**
 * End the current session and ensure storage is empty before redirecting to auth.
 * @returns {Promise<boolean>} true when no session remains
 */
export async function clearAuthSession(client) {
  if (!client?.auth) return true;

  try {
    sessionStorage.setItem("bfm-logout-at", String(Date.now()));
  } catch {
    /* ignore */
  }

  try {
    await client.auth.signOut({ scope: "global" });
  } catch (e) {
    console.warn("signOut(global):", e);
  }

  try {
    await client.auth.signOut({ scope: "local" });
  } catch (e) {
    console.warn("signOut(local):", e);
  }

  wipeAuthStorage();

  try {
    const { data: { session } } = await client.auth.getSession();
    if (session) {
      wipeAuthStorage();
      try {
        await client.auth.signOut({ scope: "global" });
      } catch {
        /* ignore */
      }
      const { data: { session: again } } = await client.auth.getSession();
      return !again;
    }
    return true;
  } catch {
    return true;
  }
}

/** Skip auto-login on auth.html for a short window after logout. */
export function shouldSkipAutoLoginRedirect() {
  try {
    const at = Number(sessionStorage.getItem("bfm-logout-at") || 0);
    return at > 0 && Date.now() - at < 20000;
  } catch {
    return false;
  }
}

export function finishLoggedOutAuthUrl() {
  if (window.history.replaceState) {
    window.history.replaceState({}, "", "auth.html");
  }
}
