/**
 * BuyForMe — UI utilities
 */

/** @param {unknown} text */
export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string|number|Date} ts
 * @param {Intl.DateTimeFormatOptions} [opts]
 */
export function formatDate(ts, opts) {
  const defaults = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  return new Date(ts).toLocaleDateString(undefined, opts || defaults);
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {"success"|"error"|"info"} [type="success"]
 * @param {number} [duration=3200]
 * @param {string} [elementId="toast"]
 */
export function showToast(message, type = "success", duration = 3200, elementId = "toast") {
  const text = String(message || "").trim();
  if (!text) return;

  let el = document.getElementById(elementId);
  if (!el) {
    el = document.createElement("div");
    el.id = elementId;
    el.className = "bfm-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }

  el.textContent = text;
  el.className = `bfm-toast bfm-toast--${type} show`;

  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.classList.remove("show");
  }, duration);
}

/**
 * Create skeleton placeholder HTML.
 * @param {number} count
 * @param {string} [className="bfm-skeleton"]
 */
export function skeletonLines(count, className = "bfm-skeleton") {
  return Array.from({ length: count }, () =>
    `<div class="${className}" style="height:14px;margin-bottom:10px;border-radius:6px"></div>`
  ).join("");
}

/**
 * Toggle loading state on an element.
 * @param {HTMLElement|null} el
 * @param {boolean} loading
 */
export function setLoading(el, loading) {
  if (!el) return;
  el.setAttribute("aria-busy", loading ? "true" : "false");
  el.classList.toggle("is-loading", loading);
}
