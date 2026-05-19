/* =============================================================
   BuyForMe — app-sounds.js
   Incoming call ring, outgoing ringback, message notifications
   ============================================================= */

let audioCtx = null;
let incomingRingInterval = null;
let outgoingRingInterval = null;
let activeNodes = [];

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/** Call once after user taps/clicks so browsers allow sound */
export function unlockSounds() {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0.001;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.02);
}

function playBeep(freq, durationSec, volume = 0.18, type = "sine", delaySec = 0) {
  const ctx = getAudioContext();
  const t0 = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durationSec + 0.05);
  activeNodes.push(osc, gain);
}

function clearActiveNodes() {
  activeNodes.forEach(n => {
    try { n.stop?.(); n.disconnect?.(); } catch {}
  });
  activeNodes = [];
}

/** Short ding for new chat messages */
export function playMessageNotification() {
  unlockSounds();
  playBeep(784, 0.1, 0.14);
  playBeep(988, 0.14, 0.12, "sine", 0.1);
}

/** Ascending tone when call connects */
export function playCallConnectedSound() {
  unlockSounds();
  playBeep(523, 0.12, 0.15);
  playBeep(659, 0.12, 0.15, "sine", 0.1);
  playBeep(784, 0.18, 0.14, "sine", 0.2);
}

/** Soft end tone */
export function playCallEndedSound() {
  playBeep(440, 0.15, 0.1);
  playBeep(330, 0.2, 0.08, "sine", 0.12);
}

function incomingRingPattern() {
  playBeep(440, 0.22, 0.22);
  playBeep(480, 0.22, 0.2, "sine", 0.25);
  playBeep(440, 0.22, 0.22, "sine", 0.5);
  playBeep(480, 0.22, 0.2, "sine", 0.75);
}

/** Classic incoming call ring (loops until stopped) */
export function playIncomingCallRing() {
  stopIncomingCallRing();
  unlockSounds();
  incomingRingPattern();
  incomingRingInterval = setInterval(incomingRingPattern, 2200);

  if (navigator.vibrate) {
    try {
      navigator.vibrate([400, 200, 400, 200, 400, 600]);
    } catch {}
  }
}

export function stopIncomingCallRing() {
  if (incomingRingInterval) {
    clearInterval(incomingRingInterval);
    incomingRingInterval = null;
  }
  try { navigator.vibrate?.(0); } catch {}
}

function outgoingRingbackPattern() {
  playBeep(350, 0.35, 0.08);
  playBeep(400, 0.35, 0.07, "sine", 0.4);
}

/** Caller hears ringback while waiting for answer */
export function playOutgoingRingback() {
  stopOutgoingRingback();
  unlockSounds();
  outgoingRingbackPattern();
  outgoingRingInterval = setInterval(outgoingRingbackPattern, 1800);
}

export function stopOutgoingRingback() {
  if (outgoingRingInterval) {
    clearInterval(outgoingRingInterval);
    outgoingRingInterval = null;
  }
}

export function stopAllCallSounds() {
  stopIncomingCallRing();
  stopOutgoingRingback();
  clearActiveNodes();
}
