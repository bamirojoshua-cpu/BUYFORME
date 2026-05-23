/* Shared paths for local dev vs GitHub Pages */

export function isLocalDevHost() {
  const host = location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

/** Buyer home (Discover) after sign-in. */
export function getBuyerDashboardHref() {
  return "buyers.html";
}

/** Shopper dashboard page that works in the current environment. */
export function getShopperDashboardHref() {
  if (isLocalDevHost()) {
    return "shopper-dashboard.dev.html";
  }
  return "shopper-dashboard.html";
}
