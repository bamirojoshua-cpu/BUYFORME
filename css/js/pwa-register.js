/**
 * BuyForMe PWA — service worker registration, install prompt, updates, connectivity.
 * Android/Chrome: beforeinstallprompt. iOS Safari: manual Add to Home Screen guide.
 */

const SW_URL = "./sw.js";
const SW_SCOPE = "./";
const INSTALL_DISMISS_KEY = "bfm-pwa-install-dismissed";

let deferredInstallPrompt = null;
let refreshing = false;

function isIosDevice() {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/** True when opened inside Instagram, Facebook, etc. — Add to Home Screen needs Safari. */
function isIosInAppBrowser() {
  if (!isIosDevice()) return false;
  const ua = navigator.userAgent.toLowerCase();
  if (/(fbav|fban|instagram|line\/|twitter|linkedinapp|snapchat|gsa\/)/i.test(ua)) return true;
  if (/crios|fxios|edgios|opr\//i.test(ua)) return false;
  return /applewebkit/i.test(ua) && !/safari/i.test(ua);
}

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
  if (attrs.pwaInstall === "1") {
    el.classList.add("bfm-pwa-bar--install");
  }
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

/** Consistent bar markup — mobile dock layout for install prompts. */
function barContentHtml({ title, subtitle = "", actionsHtml, dismissAction = "" }) {
  const subtitleBlock = subtitle
    ? `<span class="bfm-pwa-bar__subtitle">${subtitle}</span>`
    : "";
  const dismissBtn = dismissAction
    ? `<button type="button" class="bfm-pwa-bar__dismiss" data-pwa-action="${dismissAction}" aria-label="Dismiss">×</button>`
    : "";
  return `
    ${dismissBtn}
    <div class="bfm-pwa-bar__main">
      <img class="bfm-pwa-bar__icon" src="images/pwa/icon-192.png" alt="" width="44" height="44">
      <div class="bfm-pwa-bar__text">
        <strong>${title}</strong>
        ${subtitleBlock}
      </div>
    </div>
    <div class="bfm-pwa-bar__actions">${actionsHtml}</div>`;
}

function installBarActions({ primaryAction, primaryLabel, subtitle = "Get the app on your Home Screen.", dismissAction = "dismiss-install" }) {
  return barContentHtml({
    title: "Install BuyForMe",
    subtitle,
    dismissAction,
    actionsHtml: `
      <button type="button" class="bfm-pwa-bar__btn bfm-pwa-bar__btn--primary" data-pwa-action="${primaryAction}">${primaryLabel}</button>
      <button type="button" class="bfm-pwa-bar__btn bfm-pwa-bar__btn--ghost" data-pwa-action="${dismissAction}">Not now</button>`,
  });
}

function dismissInstallPrompt() {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
  hideBar(document.getElementById("bfmPwaInstallBar"));
  closeIosInstallSheet();
}

function ensureIosInstallSheet() {
  let sheet = document.getElementById("bfmIosInstallSheet");
  if (sheet) return sheet;

  sheet = document.createElement("div");
  sheet.id = "bfmIosInstallSheet";
  sheet.className = "bfm-ios-install-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "bfmIosInstallTitle");
  sheet.setAttribute("aria-hidden", "true");
  sheet.innerHTML = `
    <div class="bfm-ios-install-sheet__backdrop" data-pwa-action="close-ios-sheet"></div>
    <div class="bfm-ios-install-sheet__panel">
      <button type="button" class="bfm-ios-install-sheet__close" data-pwa-action="close-ios-sheet" aria-label="Close">
        <i class="fas fa-xmark" aria-hidden="true"></i>
      </button>
      <img class="bfm-ios-install-sheet__icon" src="images/pwa/icon-192.png" alt="" width="56" height="56">
      <h2 id="bfmIosInstallTitle">Add BuyForMe to your Home Screen</h2>
      <p class="bfm-ios-install-sheet__lead" id="bfmIosInstallLead"></p>
      <ol class="bfm-ios-install-steps" id="bfmIosInstallSteps"></ol>
      <button type="button" class="bfm-ios-install-sheet__done bfm-pwa-bar__btn bfm-pwa-bar__btn--primary" data-pwa-action="close-ios-sheet">Got it</button>
    </div>`;
  document.body.appendChild(sheet);

  sheet.querySelectorAll("[data-pwa-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.pwaAction;
      if (action === "close-ios-sheet") closeIosInstallSheet();
    });
  });

  return sheet;
}

function openIosInstallSheet() {
  const sheet = ensureIosInstallSheet();
  const inApp = isIosInAppBrowser();
  const lead = sheet.querySelector("#bfmIosInstallLead");
  const steps = sheet.querySelector("#bfmIosInstallSteps");

  if (inApp) {
    lead.textContent =
      "Install works best in Safari. Open this page in Safari first, then add BuyForMe to your Home Screen.";
    steps.innerHTML = `
      <li><span class="bfm-ios-step-num">1</span><span>Copy this page link or tap <strong>⋯</strong> and choose <strong>Open in Safari</strong>.</span></li>
      <li><span class="bfm-ios-step-num">2</span><span>In Safari, tap <strong>Share</strong> <i class="fas fa-arrow-up-from-bracket bfm-ios-share-icon" aria-hidden="true"></i> at the bottom of the screen.</span></li>
      <li><span class="bfm-ios-step-num">3</span><span>Scroll the menu and tap <strong>Add to Home Screen</strong> <i class="fas fa-plus-square bfm-ios-share-icon" aria-hidden="true"></i>.</span></li>
      <li><span class="bfm-ios-step-num">4</span><span>Tap <strong>Add</strong> in the top-right corner.</span></li>`;
  } else {
    lead.textContent = "Install BuyForMe like a native app — it opens full screen from your Home Screen.";
    steps.innerHTML = `
      <li><span class="bfm-ios-step-num">1</span><span>Tap <strong>Share</strong> <i class="fas fa-arrow-up-from-bracket bfm-ios-share-icon" aria-hidden="true"></i> in Safari’s toolbar (bottom on iPhone, top on iPad).</span></li>
      <li><span class="bfm-ios-step-num">2</span><span>Scroll down and tap <strong>Add to Home Screen</strong> <i class="fas fa-plus-square bfm-ios-share-icon" aria-hidden="true"></i>.</span></li>
      <li><span class="bfm-ios-step-num">3</span><span>Confirm the name <strong>BuyForMe</strong>, then tap <strong>Add</strong>.</span></li>`;
  }

  sheet.setAttribute("aria-hidden", "false");
  sheet.classList.add("is-open");
  document.body.classList.add("bfm-ios-install-open");
}

function closeIosInstallSheet() {
  const sheet = document.getElementById("bfmIosInstallSheet");
  if (!sheet) return;
  sheet.classList.remove("is-open");
  sheet.setAttribute("aria-hidden", "true");
  document.body.classList.remove("bfm-ios-install-open");
}

function showIosInstallBar() {
  if (!isIosDevice() || isPwaInstalled()) return;
  try {
    if (localStorage.getItem(INSTALL_DISMISS_KEY) === "1") return;
  } catch {
    /* ignore */
  }

  const bar = createBar("bfmPwaInstallBar", { pwaInstall: "1" });
  if (bar.classList.contains("is-visible")) return;

  const inApp = isIosInAppBrowser();
  showBar(
    bar,
    installBarActions({
      primaryAction: "ios-install-guide",
      primaryLabel: "Add to Home Screen",
      subtitle: inApp
        ? "Open in Safari first, then add to Home Screen."
        : "Get the app on your Home Screen.",
    })
  );
  bindBarActions(bar);

  bar.addEventListener(
    "bfm-pwa-action",
    (event) => {
      const { action } = event.detail;
      if (action === "dismiss-install") {
        dismissInstallPrompt();
        return;
      }
      if (action === "ios-install-guide") {
        openIosInstallSheet();
      }
    },
    { once: false }
  );
}

function setupInstallPrompt() {
  const bar = createBar("bfmPwaInstallBar", { pwaInstall: "1" });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;

    if (isPwaInstalled()) return;
    try {
      if (localStorage.getItem(INSTALL_DISMISS_KEY) === "1") return;
    } catch {
      /* ignore */
    }

    showBar(
      bar,
      installBarActions({
        primaryAction: "install",
        primaryLabel: "Install app",
      })
    );
    bindBarActions(bar);
  });

  bar.addEventListener("bfm-pwa-action", async (event) => {
    const { action } = event.detail;
    if (action === "dismiss-install") {
      dismissInstallPrompt();
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
    closeIosInstallSheet();
    document.dispatchEvent(new CustomEvent("bfm-pwa-installed"));
  });

  if (isIosDevice() && !deferredInstallPrompt) {
    setTimeout(showIosInstallBar, 1500);
  }
}

function setupUpdatePrompt(registration) {
  const bar = createBar("bfmPwaUpdateBar");

  const notifyUpdate = (waitingWorker) => {
    showBar(
      bar,
      barContentHtml({
        title: "Update available",
        subtitle: "A new version of BuyForMe is ready.",
        actionsHtml: `
          <button type="button" class="bfm-pwa-bar__btn bfm-pwa-bar__btn--ghost" data-pwa-action="dismiss-update">Later</button>
          <button type="button" class="bfm-pwa-bar__btn bfm-pwa-bar__btn--primary" data-pwa-action="reload">Refresh</button>`,
      })
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
    barContentHtml({
      title: "Ready for offline",
      subtitle: "Key pages are cached on this device.",
      actionsHtml: `
        <button type="button" class="bfm-pwa-bar__btn bfm-pwa-bar__btn--primary bfm-pwa-bar__btn--full" data-pwa-action="dismiss-offline-ready">OK</button>`,
    })
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
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return outcome === "accepted";
  }
  if (isIosDevice() && !isPwaInstalled()) {
    openIosInstallSheet();
    return true;
  }
  return false;
}

export function isPwaInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.navigator.standalone === true
  );
}

export function isPwaInstallAvailable() {
  if (isPwaInstalled()) return false;
  if (deferredInstallPrompt) return true;
  return isIosDevice();
}

export function isIosPwaContext() {
  return isIosDevice();
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
