/**
 * BuyForMe PWA — service worker registration, install prompt, updates, connectivity.
 */

const SW_URL = "./sw.js";
const SW_SCOPE = "./";

let deferredInstallPrompt = null;
let refreshing = false;

function createBar(id, attrs = {}) {
  let el = document.getElementById(id);
  if (el) return el;

  el = document.createElement("div");
  el.id = id;
  el.className = "bfm-pwa-bar";
  el.setAttribute("role", "region");
  Object.entries(attrs).forEach(([key, value]) => {
    el.dataset[key] = value;
  });
  document.body.appendChild(el);
  return el;
}

function showBar(el, html) {
  el.innerHTML = html;
  requestAnimationFrame(() => el.classList.add("is-visible"));
}

function hideBar(el) {
  el.classList.remove("is-visible");
}

function bindBarActions(el) {
  el.querySelectorAll("[data-pwa-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.pwaAction;
      el.dispatchEvent(new CustomEvent("bfm-pwa-action", { detail: { action }, bubbles: true }));
    });
  });
}

function setupInstallPrompt() {
  const bar = createBar("bfmPwaInstallBar", { pwaInstall: "1" });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;

    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (localStorage.getItem("bfm-pwa-install-dismissed") === "1") return;

    showBar(
      bar,
      `<img class="bfm-pwa-bar__icon" src="images/pwa/icon-192.png" alt="" width="32" height="32">
       <div class="bfm-pwa-bar__text"><strong>Install BuyForMe</strong>Add to your home screen for quick access.</div>
       <div class="bfm-pwa-bar__actions">
         <button type="button" class="bfm-pwa-bar__btn bfm-pwa-bar__btn--ghost" data-pwa-action="dismiss-install">Not now</button>
         <button type="button" class="bfm-pwa-bar__btn bfm-pwa-bar__btn--primary" data-pwa-action="install">Install</button>
       </div>`
    );
    bindBarActions(bar);
  });

  bar.addEventListener("bfm-pwa-action", async (event) => {
    const { action } = event.detail;
    if (action === "dismiss-install") {
      localStorage.setItem("bfm-pwa-install-dismissed", "1");
      hideBar(bar);
      return;
    }
    if (action === "install" && deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      hideBar(bar);
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    hideBar(bar);
    document.dispatchEvent(new CustomEvent("bfm-pwa-installed"));
  });
}

function setupUpdatePrompt(registration) {
  const bar = createBar("bfmPwaUpdateBar");

  const notifyUpdate = (waitingWorker) => {
    showBar(
      bar,
      `<img class="bfm-pwa-bar__icon" src="images/pwa/icon-192.png" alt="" width="32" height="32">
       <div class="bfm-pwa-bar__text"><strong>Update available</strong>A new version of BuyForMe is ready.</div>
       <div class="bfm-pwa-bar__actions">
         <button type="button" class="bfm-pwa-bar__btn bfm-pwa-bar__btn--ghost" data-pwa-action="dismiss-update">Later</button>
         <button type="button" class="bfm-pwa-bar__btn bfm-pwa-bar__btn--primary" data-pwa-action="reload">Refresh</button>
       </div>`
    );
    bindBarActions(bar);

    bar.addEventListener(
      "bfm-pwa-action",
      (event) => {
        const { action } = event.detail;
        if (action === "dismiss-update") {
          hideBar(bar);
          return;
        }
        if (action === "reload" && waitingWorker) {
          waitingWorker.postMessage({ type: "SKIP_WAITING" });
        }
      },
      { once: true }
    );
  };

  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;

    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        notifyUpdate(registration.waiting || worker);
      }
    });
  });

  if (registration.waiting && navigator.serviceWorker.controller) {
    notifyUpdate(registration.waiting);
  }
}

function setupOfflineIndicator() {
  let strip = document.getElementById("bfmPwaOfflineStrip");
  if (!strip) {
    strip = document.createElement("div");
    strip.id = "bfmPwaOfflineStrip";
    strip.className = "bfm-pwa-offline-strip";
    strip.setAttribute("role", "status");
    strip.setAttribute("aria-live", "polite");
    strip.textContent = "You’re offline — some features may be unavailable.";
    document.body.prepend(strip);
  }

  const sync = () => {
    strip.classList.toggle("is-visible", !navigator.onLine);
  };

  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  sync();
}

function setupOfflineReadyToast() {
  const bar = createBar("bfmPwaOfflineReadyBar");

  showBar(
    bar,
    `<img class="bfm-pwa-bar__icon" src="images/pwa/icon-192.png" alt="" width="32" height="32">
     <div class="bfm-pwa-bar__text"><strong>Ready for offline</strong>Key pages are cached on this device.</div>
     <div class="bfm-pwa-bar__actions">
       <button type="button" class="bfm-pwa-bar__btn bfm-pwa-bar__btn--primary" data-pwa-action="dismiss-offline-ready">OK</button>
     </div>`
  );
  bindBarActions(bar);
  bar.addEventListener("bfm-pwa-action", () => hideBar(bar), { once: true });

  setTimeout(() => hideBar(bar), 8000);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    setupUpdatePrompt(registration);

    if (registration.active && !navigator.serviceWorker.controller) {
      // First SW install — optional offline-ready hint after activation
      navigator.serviceWorker.ready.then(() => {
        if (!sessionStorage.getItem("bfm-pwa-offline-ready-shown")) {
          sessionStorage.setItem("bfm-pwa-offline-ready-shown", "1");
          setupOfflineReadyToast();
        }
      });
    }
  } catch (error) {
    console.warn("Service worker registration failed:", error);
  }
}

/** Programmatic install (e.g. from settings). Returns false if unavailable. */
export async function promptPwaInstall() {
  if (!deferredInstallPrompt) return false;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  return outcome === "accepted";
}

export function isPwaInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.navigator.standalone === true
  );
}

export function isPwaInstallAvailable() {
  return Boolean(deferredInstallPrompt);
}

function init() {
  setupInstallPrompt();
  setupOfflineIndicator();
  registerServiceWorker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
