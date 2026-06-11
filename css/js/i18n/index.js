/**
 * BuyForMe — lightweight i18n (English + French starter)
 */

const STORAGE_KEY = "bfm-locale";

const messages = {
  en: {
    "nav.discover": "Discover",
    "nav.wishlist": "Wishlist",
    "nav.cart": "Cart",
    "nav.orders": "Orders",
    "nav.messages": "Messages",
    "orders.title": "My orders",
    "orders.subtitle": "Track purchases and pay when your shopper accepts",
    "orders.pay": "Pay now",
    "orders.track": "Track order",
    "orders.shipment": "In transit",
    "orders.payPaystack": "Pay with Paystack",
    "orders.payStripe": "Pay with card",
    "tracking.subtitle": "Live updates from your shopper to your door",
    "tracking.title": "Order Tracking",
    "tracking.shipment": "Shipment Progress",
    "common.loading": "Loading…",
    "common.save": "Save",
  },
  fr: {
    "nav.discover": "Découvrir",
    "nav.wishlist": "Liste de souhaits",
    "nav.cart": "Panier",
    "nav.orders": "Commandes",
    "nav.messages": "Messages",
    "orders.title": "Mes commandes",
    "orders.subtitle": "Suivez vos achats et payez après acceptation",
    "orders.pay": "Payer",
    "orders.track": "Suivre",
    "orders.shipment": "En transit",
    "orders.payPaystack": "Payer avec Paystack",
    "orders.payStripe": "Payer par carte",
    "tracking.subtitle": "Mises à jour en direct jusqu'à la livraison",
    "tracking.title": "Suivi de commande",
    "tracking.shipment": "Progression de l'expédition",
    "common.loading": "Chargement…",
    "common.save": "Enregistrer",
  },
};

let locale = localStorage.getItem(STORAGE_KEY) || "en";

export function getLocale() {
  return locale;
}

export function setLocale(code) {
  if (!messages[code]) return;
  locale = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch { /* ignore */ }
  document.documentElement.lang = code;
  applyTranslations();
}

export function t(key, fallback = "") {
  return messages[locale]?.[key] ?? messages.en?.[key] ?? (fallback || key);
}

export function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const val = t(key);
    if (val) el.textContent = val;
  });
}

export function initI18n() {
  document.documentElement.lang = locale;
  applyTranslations();
}
