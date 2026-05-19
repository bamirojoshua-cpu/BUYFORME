/* Shared verified shopper badge (Facebook-style check next to name) */

export const VERIFIED_BADGE_SRC = "images/verified-badge.png";
const VERIFIED_BADGE_VERSION = "2";

/** Resolve image URL for GitHub Pages subpaths and Vite dev */
export function getVerifiedBadgeSrc() {
  if (typeof document === "undefined") return `${VERIFIED_BADGE_SRC}?v=${VERIFIED_BADGE_VERSION}`;
  try {
    const url = new URL(VERIFIED_BADGE_SRC, document.baseURI);
    url.searchParams.set("v", VERIFIED_BADGE_VERSION);
    return url.href;
  } catch {
    return `${VERIFIED_BADGE_SRC}?v=${VERIFIED_BADGE_VERSION}`;
  }
}

export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline <img> — transparent PNG, no pill background */
export function verifiedBadgeImg(size = 20) {
  const src = getVerifiedBadgeSrc();
  return `<img src="${src}" alt="Verified" class="verified-check" width="${size}" height="${size}" loading="eager" decoding="async">`;
}

/** Name + badge, e.g. for headings and card titles */
export function nameWithVerifiedBadge(name, options = {}) {
  const { tag = "span", className = "" } = options;
  const cls = ["name-with-verified", className].filter(Boolean).join(" ");
  const size = options.size ?? 20;
  return `<${tag} class="${cls}"><span class="name-text">${escapeHtml(name)}</span>${verifiedBadgeImg(size)}</${tag}>`;
}

/** Extract plain name from an element that may include the badge */
export function plainNameFromElement(el) {
  if (!el) return "";
  const text = el.querySelector?.(".name-text")?.textContent;
  if (text) return text.trim();
  return (el.textContent || "").replace(/\s*Verified.*/i, "").trim();
}
