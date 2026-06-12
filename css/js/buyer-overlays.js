/**
 * Shell-level overlays — persist across soft tab navigation.
 * Settings, payment processing, and review modals live outside #buyer-content.
 */

export function ensureBuyerOverlays() {
  if (!document.getElementById("settingsOverlay")) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="settings-overlay" id="settingsOverlay" onclick="closeSettings(event)" aria-hidden="true">
        <aside class="settings-panel" role="dialog" aria-labelledby="settingsTitle" onclick="event.stopPropagation()">
          <div class="settings-panel__head">
            <div>
              <p class="settings-panel__eyebrow">Your account</p>
              <h2 id="settingsTitle">Settings</h2>
            </div>
            <button type="button" class="settings-close" onclick="toggleSettings()" aria-label="Close settings">
              <i class="fas fa-xmark"></i>
            </button>
          </div>
          <nav class="settings-tabs" aria-label="Settings sections">
            <button type="button" class="settings-tab active" data-tab="profile" onclick="switchTab('profile')">
              <i class="fas fa-user"></i> Profile
            </button>
            <button type="button" class="settings-tab" data-tab="shipping" onclick="switchTab('shipping')">
              <i class="fas fa-location-dot"></i> Shipping
            </button>
            <button type="button" class="settings-tab" data-tab="support" onclick="switchTab('support')">
              <i class="fas fa-life-ring"></i> Support
            </button>
            <button type="button" class="settings-tab" data-tab="payments" onclick="switchTab('payments')">
              <i class="fas fa-wallet"></i> Payments
            </button>
          </nav>
          <div class="settings-form" id="settingsForm"></div>
        </aside>
      </div>`
    );
  }

  if (!document.getElementById("processingOverlay")) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="processing-overlay" id="processingOverlay">
        <div class="processing-box">
          <div class="processing-spinner"></div>
          <h3>Confirming payment…</h3>
          <p>Please wait: do not close this page.</p>
        </div>
      </div>`
    );
  }

  if (!document.getElementById("reviewModal")) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="review-modal" id="reviewModal">
        <div class="review-modal__panel">
          <button type="button" class="review-modal__close" onclick="closeReviewModal()" aria-label="Close"><i class="fas fa-xmark"></i></button>
          <h3 style="font-family:Sora,sans-serif;margin-bottom:6px">Leave a review</h3>
          <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:16px">for <strong id="reviewShopperName"></strong></p>
          <p class="buyer-label">Rating</p>
          <div class="star-picker" id="starPicker">
            <span onclick="setStars(1)">★</span><span onclick="setStars(2)">★</span><span onclick="setStars(3)">★</span><span onclick="setStars(4)">★</span><span onclick="setStars(5)">★</span>
          </div>
          <label class="buyer-label" for="reviewText">Your review</label>
          <textarea id="reviewText" class="buyer-textarea" rows="4" placeholder="Describe your experience…"></textarea>
          <p id="reviewError" style="font-size:0.82rem;color:var(--red);margin:12px 0;display:none"></p>
          <button type="button" class="btn-pill btn-pill--primary" style="width:100%" id="reviewSubmitBtn" onclick="submitReview()">Submit review</button>
        </div>
      </div>`
    );
  }
}
