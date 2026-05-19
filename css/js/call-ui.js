/* Shared WhatsApp-style incoming call UI */

export function getCallInitials(name) {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || "?").toUpperCase();
}

export function escapeCallHtml(text) {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Full-screen incoming call (WhatsApp style).
 * Returns the root element; call hideIncomingCallScreen() to remove.
 */
export function showIncomingCallScreen({ partnerName, callType, onAccept, onDecline }) {
  hideIncomingCallScreen();

  const isVideo = callType === "video";
  const initials = getCallInitials(partnerName);
  const safeName = escapeCallHtml(partnerName || "Unknown");
  const typeLabel = isVideo ? "Video call" : "Voice call";

  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;

  const root = document.createElement("div");
  root.id = "bfmIncomingCall";
  root.className = `bfm-incoming-screen${isMobile ? " bfm-incoming-screen--mobile" : ""}`;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", `Incoming ${typeLabel}`);

  root.innerHTML = `
    <div class="bfm-incoming-top">
      <p class="bfm-incoming-type">Incoming ${typeLabel.toLowerCase()}</p>
      <div class="bfm-call-avatar bfm-call-avatar--lg" aria-hidden="true">${initials}</div>
      <h2 class="bfm-incoming-name">${safeName}</h2>
      <p class="bfm-incoming-sub">${typeLabel}…</p>
    </div>
    <div class="bfm-incoming-actions">
      <div class="bfm-incoming-action">
        <button type="button" class="bfm-incoming-action-btn bfm-incoming-action-btn--decline" id="bfmIncomingDecline" aria-label="Decline call">
          <i class="fa-solid fa-phone-slash"></i>
        </button>
        <span class="bfm-incoming-action-label">Decline</span>
      </div>
      <div class="bfm-incoming-action">
        <button type="button" class="bfm-incoming-action-btn bfm-incoming-action-btn--accept" id="bfmIncomingAccept" aria-label="Accept call">
          <i class="fa-solid ${isVideo ? "fa-video" : "fa-phone"}"></i>
        </button>
        <span class="bfm-incoming-action-label">Accept</span>
      </div>
    </div>`;

  document.body.appendChild(root);

  root.querySelector("#bfmIncomingAccept")?.addEventListener("click", () => onAccept?.());
  root.querySelector("#bfmIncomingDecline")?.addEventListener("click", () => onDecline?.());

  return root;
}

export function hideIncomingCallScreen() {
  document.getElementById("bfmIncomingCall")?.remove();
  document.getElementById("incomingCallBanner")?.remove();
  document.getElementById("shopperIncomingBanner")?.remove();
}
