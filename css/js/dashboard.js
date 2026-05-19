/* =============================================================
   BuyForMe — Shopper Dashboard JS
   ✅ Image sharing
   ✅ Voice notes
   ✅ Video calling (WebRTC)
   ✅ Voice calling (WebRTC, audio only)
   ✅ Payout details in settings
   ✅ Real payout history in earnings
   ============================================================= */

import { supabase } from "./supabase.js";
import {
  getConvId,
  getMessagesForPartner,
  getPartnerUidFromMessage,
  getConversationSummaries,
  getUnreadMap,
  getPreviewText,
  buildMessage,
  sendChatMessage,
  sendCallInvite,
  markConversationRead,
  setConversationPartner,
  compressImageToBlob,
  uploadChatBlob,
  subscribeInbox,
} from "./chat-local.js";
import {
  startOutgoingCall,
  acceptIncomingCall,
  prepareIncomingCallSignaling,
  clearIncomingCallPrep,
  rejectIncomingCall,
} from "./call-webrtc.js";
import {
  unlockSounds,
  playMessageNotification,
  playIncomingCallRing,
  stopIncomingCallRing,
  playOutgoingRingback,
  stopOutgoingRingback,
  stopAllCallSounds,
} from "./app-sounds.js";
import { showIncomingCallScreen, hideIncomingCallScreen } from "./call-ui.js";

/* ─── STATE ─── */
let currentUser    = null;
let currentProfile = null;
let allPayouts     = [];
const SHOPPER_STATUSES = ["paid", "purchased", "delivering", "delivered"];

/* Chat state */
let activeChatConvId  = null;
let activeChatPartner = null;
let allShopperConvs   = [];

/* Voice note state */
let shopperMediaRecorder = null;
let shopperAudioChunks   = [];
let shopperIsRecording   = false;

let shopperActiveCall = null;
let shopperThreadIds  = new Set();
let shopperRefreshTimer = null;

function scheduleShopperRefreshList() {
  clearTimeout(shopperRefreshTimer);
  shopperRefreshTimer = setTimeout(() => renderShopperChatList(), 120);
}

function getShopperChatUserId() {
  return String(currentProfile?.uid || currentUser?.id || "");
}

/* ─── INIT ─── */
document.addEventListener("DOMContentLoaded", async () => {
  document.body.addEventListener("click", () => unlockSounds(), { once: true });

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "auth.html"; return; }
  currentUser = session.user;

  const { data: profile } = await supabase
    .from("users").select("*").eq("uid", currentUser.id).maybeSingle();

  if (!profile || profile.role !== "shopper") { window.location.href = "auth.html"; return; }
  if (profile.verification_status?.toLowerCase() !== "approved") { window.location.href = "verify.html"; return; }

  currentProfile = profile;

  renderSidebarProfile();
  await renderRequests();
  await renderOrders();
  await renderStats();
  await renderEarnings();
  loadSettingsIntoForm();
  initTabs();
  initAvatarUpload();
  initShopperVideoUpload();
  updateNotifDot();
  initRealtimeOrders();
  subscribeInbox(supabase, getShopperChatUserId(), {
    onMessage: handleShopperInboxMessage,
    onCallInvite: payload => handleShopperIncomingCall(payload),
  });
  await renderShopperChatList();

  document.getElementById("shopperChatInput")?.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendShopperMessage(); }
  });

  document.getElementById("msgConvSearch")?.addEventListener("input", function (e) {
    filterShopperConversations(e.target.value.trim());
  });
});

/* ─── HELPERS ─── */
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  setTimeout(() => { t.className = "toast"; }, 2800);
}

function formatTime(ts) {
  const d = new Date(ts), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function statusClass(s) { return "status-" + s.toLowerCase().replace(" ", "-"); }
function getStatusBadge(s) { return `<span class="status-badge ${statusClass(s)}">${s}</span>`; }

function escapeHtml(t) {
  return (t || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}


function renderSidebarProfile() {
  const name = currentProfile.name || "Shopper";
  document.getElementById("sidebarName").textContent = name;
  document.getElementById("welcomeMsg").textContent  = `Welcome back, ${name.split(" ")[0]}!`;
  const el = document.getElementById("sidebarAvatar");
  if (currentProfile.avatar_url) {
    el.innerHTML = `<img src="${currentProfile.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else { el.textContent = name[0].toUpperCase(); }
}

async function renderStats() {
  const orders    = await getOrders();
  const completed = orders.filter(o => o.status === "delivered").length;
  const earned    = orders.filter(o => o.status === "delivered").reduce((s,o) => s + (parseFloat(o.budget)||0)*0.85, 0);
  document.getElementById("statEarnings").textContent = `$${earned.toFixed(0)}`;
  document.getElementById("statOrders").textContent   = completed;
  document.getElementById("statRating").textContent   = currentProfile.rating || "—";
}

/* ─── TABS ─── */
function initTabs() {
  const tabs = document.querySelectorAll(".sidebar-menu a[data-tab]");
  tabs.forEach(tab => {
    tab.addEventListener("click", function (e) {
      e.preventDefault();
      tabs.forEach(t => t.classList.remove("active"));
      this.classList.add("active");
      document.querySelectorAll(".dash-section").forEach(s => s.classList.remove("active"));
      const target = document.getElementById(this.dataset.tab);
      if (target) target.classList.add("active");
      if (this.dataset.tab === "messages-section") {
        const b = document.getElementById("msgBadge");
        if (b) b.style.display = "none";
        renderShopperChatList();
      } else {
        document.querySelector(".messages-section-inner")?.classList.remove("thread-open");
      }
      if (this.dataset.tab === "requests-section") renderRequests();
      if (this.dataset.tab === "orders-section")   renderOrders();
      if (this.dataset.tab === "earnings-section") renderEarnings();
    });
  });
}

/* ─── REQUESTS ─── */
async function renderRequests() {
  const list = document.getElementById("requestList");
  const ov   = document.getElementById("overviewRequestList");
  list.innerHTML = ov.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading...</p></div>`;

  const { data: reqs, error } = await supabase
    .from("requests").select("*").eq("shopper_id", currentUser.id).eq("status","pending")
    .order("created_at",{ascending:false});

  if (error) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Failed to load.</p></div>`; return; }

  document.getElementById("requestCount").textContent     = `${reqs.length} new`;
  document.getElementById("overviewReqCount").textContent = `${reqs.length} new`;

  const badge = document.getElementById("reqBadge");
  if (reqs.length > 0) { badge.textContent = reqs.length; badge.style.display = "inline-block"; }
  else badge.style.display = "none";

  if (reqs.length === 0) {
    const e = `<div class="empty-state"><div class="empty-icon">📭</div><p>No new requests right now.</p></div>`;
    list.innerHTML = ov.innerHTML = e; return;
  }
  list.innerHTML = reqs.map(buildRequestCard).join("");
  ov.innerHTML   = reqs.slice(0,3).map(buildRequestCard).join("");
}

function buildRequestCard(r) {
  return `
    <div class="request-item">
      <div>
        <h4>${r.product_name}</h4>
        <div class="request-meta">
          <span><i class="fas fa-user"></i> ${r.buyer_name}</span>
          <span><i class="fas fa-tag"></i> ${r.category||"—"}</span>
          <span><i class="fas fa-clock"></i> ${new Date(r.created_at).toLocaleDateString()}</span>
        </div>
        ${r.notes ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-top:6px;line-height:1.5">${r.notes}</p>` : ""}
      </div>
      <div class="request-action">
        <div class="service-fee">${r.currency||"$"}${r.budget}</div>
        <div class="fee-label">Budget</div>
        <button class="btn btn-primary" onclick="acceptRequest('${r.id}','${r.product_name}')">Accept</button>
        <button class="btn btn-danger"  onclick="declineRequest('${r.id}','${r.product_name}')">Decline</button>
      </div>
    </div>`;
}

window.acceptRequest = async function (id, name) {
  const { error } = await supabase.from("requests").update({status:"accepted"}).eq("id",id);
  if (error) { showToast("Failed to accept.", "error"); return; }
  addNotification(`New order accepted: ${name}`);
  showToast(`✅ Request accepted: ${name}`);
  await renderRequests(); await renderOrders(); await renderStats();
};

window.declineRequest = async function (id, name) {
  if (!confirm(`Decline request for "${name}"?`)) return;
  const { error } = await supabase.from("requests").update({status:"cancelled"}).eq("id",id);
  if (error) { showToast("Failed to decline.", "error"); return; }
  showToast(`Request declined: ${name}`, "error");
  await renderRequests();
};

/* ─── ORDERS ─── */
async function getOrders() {
  const { data, error } = await supabase.from("requests").select("*")
    .eq("shopper_id", currentUser.id).neq("status","pending").neq("status","cancelled")
    .order("created_at",{ascending:false});
  if (error) return [];
  return data || [];
}

async function renderOrders() {
  const orders = await getOrders();
  const list   = document.getElementById("orderList");
  document.getElementById("orderCount").textContent = `${orders.length} order${orders.length!==1?"s":""}`;

  if (orders.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🛍️</div><p>No orders yet.</p></div>`; return;
  }

  list.innerHTML = orders.map(o => {
    const isLocked    = o.status==="accepted" || o.status==="payment";
    const isCompleted = o.status==="delivered";
    let action = "";
    if (isCompleted)    action = `<button class="btn btn-ghost" disabled>Completed ✅</button>`;
    else if (isLocked)  action = `<button class="btn btn-secondary" disabled><i class="fas fa-lock" style="margin-right:6px"></i>Waiting for Payment</button>`;
    else                action = `<button class="btn btn-primary" onclick="cycleOrderStatus('${o.id}','${o.status}')">Update Status</button>`;

    return `
      <div class="request-item">
        <div>
          <h4>${o.product_name}</h4>
          <div class="request-meta">
            <span><i class="fas fa-user"></i> ${o.buyer_name}</span>
            <span><i class="fas fa-map-marker-alt"></i> ${o.address||"—"}</span>
            <span><i class="fas fa-dollar-sign"></i> ${o.currency||"$"}${o.budget} budget</span>
          </div>
          <div style="margin-top:8px">${getStatusBadge(o.status)}</div>
        </div>
        <div class="request-action">${action}</div>
      </div>`;
  }).join("");
}

window.cycleOrderStatus = async function (id, current) {
  const idx = SHOPPER_STATUSES.indexOf(current);
  if (idx === -1) { showToast("Cannot update this order.", "error"); return; }
  if (idx === SHOPPER_STATUSES.length-1) { showToast("Already completed.", "error"); return; }
  const next = SHOPPER_STATUSES[idx+1];
  const { error } = await supabase.from("requests").update({status:next}).eq("id",id);
  if (error) { showToast("Failed to update.", "error"); return; }
  showToast(`✅ Updated to: ${next}`);
  await renderOrders(); await renderStats(); await renderEarnings();
};

/* ─── REALTIME ORDERS ─── */
function initRealtimeOrders() {
  supabase.channel("shopper-orders-"+currentUser.id)
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"requests",filter:`shopper_id=eq.${currentUser.id}`},
      async (payload) => {
        const u = payload.new;
        if (u.status==="paid") {
          showToast(`💳 ${u.buyer_name} paid for "${u.product_name}"!`);
          addNotification(`Payment received from ${u.buyer_name} for "${u.product_name}"`);
        }
        if (u.status==="funded") {
          showToast(`🏦 Funds released for "${u.product_name}"! Check your payout details.`);
          addNotification(`Funds released for "${u.product_name}" — go purchase the item`);
        }
        await renderOrders(); await renderStats(); await renderEarnings();
      }).subscribe();
}

/* ══════════════════════════════════════════════
   EARNINGS — real payout history from payouts table
══════════════════════════════════════════════ */
async function renderEarnings() {
  const orders    = await getOrders();
  const delivered = orders.filter(o => o.status === "delivered");
  const active    = orders.filter(o => !["delivered","cancelled"].includes(o.status));

  // Fetch real payouts from DB
  const { data: payouts } = await supabase
    .from("payouts")
    .select("*")
    .eq("shopper_id", currentUser.id)
    .order("paid_at", { ascending: false });

  allPayouts = payouts || [];

  const totalPaidOut  = allPayouts.reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
  const totalEarned   = delivered.reduce((s,o) => s + (parseFloat(o.budget)||0) * 0.85, 0);
  const pendingEarned = active.reduce((s,o) => s + (parseFloat(o.budget)||0) * 0.85, 0);

  // This month
  const now = new Date();
  const thisMonthPayouts = allPayouts.filter(p => {
    const d = new Date(p.paid_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const thisMonth = thisMonthPayouts.reduce((s,p) => s + (parseFloat(p.amount)||0), 0);

  document.getElementById("earnTotal").textContent     = `$${totalPaidOut.toFixed(2)}`;
  document.getElementById("earnMonth").textContent     = `$${thisMonth.toFixed(2)}`;
  document.getElementById("earnPending").textContent   = `$${pendingEarned.toFixed(2)}`;
  document.getElementById("earnCompleted").textContent = delivered.length;

  const list = document.getElementById("earningsList");

  // Payout history table
  if (allPayouts.length === 0) {
    list.innerHTML = `
      <h2 class="section-title" style="margin-bottom:12px">Payout History</h2>
      <div class="empty-state">
        <div class="empty-icon">💳</div>
        <p>No payouts received yet.<br>Complete orders to start earning.</p>
      </div>`;
    return;
  }

  list.innerHTML = `
    <h2 class="section-title" style="margin-bottom:16px">Payout History</h2>
    <div style="background:var(--white);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--bg)">
            <th style="padding:10px 16px;font-size:0.72rem;color:var(--text-muted);text-align:left;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Product</th>
            <th style="padding:10px 16px;font-size:0.72rem;color:var(--text-muted);text-align:left;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Amount</th>
            <th style="padding:10px 16px;font-size:0.72rem;color:var(--text-muted);text-align:left;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Method</th>
            <th style="padding:10px 16px;font-size:0.72rem;color:var(--text-muted);text-align:left;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Reference</th>
            <th style="padding:10px 16px;font-size:0.72rem;color:var(--text-muted);text-align:left;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Date</th>
            <th style="padding:10px 16px;font-size:0.72rem;color:var(--text-muted);text-align:left;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Status</th>
          </tr>
        </thead>
        <tbody>
          ${allPayouts.map(p => `
            <tr style="border-top:1px solid var(--border)">
              <td style="padding:12px 16px;font-size:0.85rem;font-weight:500">${p.product_name || "—"}</td>
              <td style="padding:12px 16px;font-size:0.88rem;font-weight:700;color:var(--green)">$${parseFloat(p.amount||0).toFixed(2)}</td>
              <td style="padding:12px 16px;font-size:0.8rem;color:var(--text-muted)">${methodIcon(p.method)} ${p.method || "—"}</td>
              <td style="padding:12px 16px;font-size:0.75rem;color:var(--text-muted);font-family:monospace">${p.reference || "—"}</td>
              <td style="padding:12px 16px;font-size:0.78rem;color:var(--text-muted)">${p.paid_at ? new Date(p.paid_at).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}) : "—"}</td>
              <td style="padding:12px 16px">
                <span style="background:#d1fae5;color:#065f46;font-size:0.68rem;font-weight:600;padding:3px 8px;border-radius:6px">Received ✓</span>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${allPayouts.length > 0 ? `
    <div style="margin-top:14px;padding:14px 18px;background:var(--green-light);border-radius:var(--radius);display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:0.85rem;color:var(--green-dark);font-weight:600">💰 Total Received</span>
      <span style="font-size:1.1rem;font-weight:700;color:var(--green)">$${totalPaidOut.toFixed(2)}</span>
    </div>` : ""}`;
}

function methodIcon(method) {
  if (!method) return "";
  const m = method.toLowerCase();
  if (m.includes("paypal"))  return "🅿️";
  if (m.includes("momo") || m.includes("mobile")) return "📱";
  if (m.includes("wise") || m.includes("revolut")) return "🌍";
  if (m.includes("bank"))    return "🏦";
  return "💳";
}

/* ─── SETTINGS ─── */
function loadSettingsIntoForm() {
  document.getElementById("settingName").value           = currentProfile.name            || "";
  document.getElementById("settingEmail").value          = currentProfile.email           || "";
  document.getElementById("settingPhone").value          = currentProfile.phone           || "";
  document.getElementById("settingLocation").value       = currentProfile.location        || "";
  document.getElementById("settingAbout").value          = currentProfile.about           || "";
  document.getElementById("settingFee").value            = currentProfile.fee             || "";
  document.getElementById("settingYearsActive").value    = parseInt(currentProfile.years_active)||"";
  document.getElementById("settingResponseTime").value   = currentProfile.response_time   || "";
  document.getElementById("settingCompletionRate").value = currentProfile.completion_rate || "";
  document.getElementById("settingTags").value           = currentProfile.tags            || "";

  // Payout fields
  const methodEl = document.getElementById("payoutMethod");
  if (methodEl && currentProfile.payout_method) {
    methodEl.value = currentProfile.payout_method;
    togglePayoutFields(currentProfile.payout_method);
  }
  if (document.getElementById("payoutAccountName"))   document.getElementById("payoutAccountName").value   = currentProfile.payout_account_name   || "";
  if (document.getElementById("payoutAccountNumber")) document.getElementById("payoutAccountNumber").value = currentProfile.payout_account_number || "";
  if (document.getElementById("payoutBankName"))      document.getElementById("payoutBankName").value      = currentProfile.payout_bank_name      || "";
  if (document.getElementById("payoutCountry"))       document.getElementById("payoutCountry").value       = currentProfile.payout_country        || "";
  if (document.getElementById("payoutEmail"))         document.getElementById("payoutEmail").value         = currentProfile.payout_email          || "";

  const toggle = document.getElementById("notifToggle");
  if (toggle) toggle.className = `toggle-track ${currentProfile.notifications?"on":""}`;
  if (currentProfile.avatar_url)
    document.getElementById("avatarPreview").innerHTML =
      `<img src="${currentProfile.avatar_url}" style="width:64px;height:64px;border-radius:50%;object-fit:cover">`;

  renderShopperVideosManager();
}

/* ─── PROFILE VIDEOS ─── */
const MAX_PROFILE_VIDEOS = 6;
const MAX_VIDEO_BYTES    = 300 * 1024 * 1024; // ~4–5 min phone video
const VIDEO_BUCKET       = "shopper-videos";
const VIDEO_UPLOAD_MS    = 15 * 60 * 1000;  // 15 min for large uploads on slow Wi‑Fi
const VIDEO_EXTENSIONS   = new Set(["mp4", "webm", "mov", "m4v", "avi", "mkv", "3gp"]);

function mimeFromExt(ext) {
  const map = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    "3gp": "video/3gpp",
  };
  return map[ext] || "video/mp4";
}

function isVideoFile(file, ext) {
  if (file.type && file.type.startsWith("video/")) return true;
  return VIDEO_EXTENSIONS.has(ext);
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(v => { clearTimeout(timer); resolve(v); })
      .catch(e => { clearTimeout(timer); reject(e); });
  });
}

function parseProfileVideos(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function renderShopperVideosManager() {
  const list = document.getElementById("shopperVideosList");
  const btn  = document.getElementById("btnUploadVideo");
  if (!list) return;

  const videos = parseProfileVideos(currentProfile.profile_videos);

  if (videos.length === 0) {
    list.innerHTML = `<p class="shopper-videos-empty">No videos yet. Upload your first clip.</p>`;
  } else {
    list.innerHTML = videos.map(v => `
      <div class="shopper-video-item" data-id="${v.id}">
        <video src="${v.url}" muted playsinline preload="metadata"></video>
        <div class="shopper-video-meta">
          <span class="shopper-video-title">${escapeHtml(v.title || "Video")}</span>
          <button type="button" class="shopper-video-delete" onclick="deleteShopperVideo('${v.id}')" title="Remove">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>`).join("");
  }

  if (btn) btn.disabled = videos.length >= MAX_PROFILE_VIDEOS;
}

function setVideoUploadStatus(text, isError = false) {
  const el = document.getElementById("shopperVideoUploadStatus");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "var(--red)" : "var(--text-muted)";
}

async function persistProfileVideos(videos) {
  const { error } = await supabase
    .from("users")
    .update({ profile_videos: videos })
    .eq("uid", currentUser.id);
  if (error) throw error;
  currentProfile.profile_videos = videos;
}

function resetVideoUploadUi() {
  const btn = document.getElementById("btnUploadVideo");
  const videos = parseProfileVideos(currentProfile.profile_videos);
  if (btn) btn.disabled = videos.length >= MAX_PROFILE_VIDEOS;
}

function initShopperVideoUpload() {
  const input = document.getElementById("shopperVideoInput");
  if (!input) return;

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const videos = parseProfileVideos(currentProfile.profile_videos);
    if (videos.length >= MAX_PROFILE_VIDEOS) {
      showToast(`Maximum ${MAX_PROFILE_VIDEOS} videos allowed.`, "error");
      return;
    }

    const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
    if (!isVideoFile(file, ext)) {
      showToast("Please choose a video file (MP4, MOV, WebM, etc.).", "error");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      showToast("Video must be under 300 MB (about 4–5 minutes).", "error");
      return;
    }

    const defaultTitle = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "My video";
    const title = window.prompt("Video title (shown to buyers):", defaultTitle);
    if (title === null) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showToast("Session expired. Please log in again.", "error");
      return;
    }

    const id           = crypto.randomUUID();
    const path         = `${session.user.id}/${id}.${ext}`;
    const contentType  = (file.type && file.type.startsWith("video/")) ? file.type : mimeFromExt(ext);
    const uploadBtn    = document.getElementById("btnUploadVideo");

    setVideoUploadStatus("Uploading… 4–5 min videos may take several minutes.");
    if (uploadBtn) uploadBtn.disabled = true;

    let uploadedPath = null;

    try {
      const { error: upErr } = await withTimeout(
        supabase.storage.from(VIDEO_BUCKET).upload(path, file, {
          upsert: true,
          contentType,
          cacheControl: "3600",
        }),
        VIDEO_UPLOAD_MS,
        "Upload timed out. Try MP4, a stronger Wi‑Fi connection, or a slightly shorter clip."
      );

      if (upErr) {
        const hint = upErr.message?.includes("mime")
          ? " In Supabase: Storage → shopper-videos → allow all video types, or use MP4."
          : "";
        throw new Error((upErr.message || "Storage upload failed.") + hint);
      }

      uploadedPath = path;
      setVideoUploadStatus("Saving to your profile…");

      const { data: urlData } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(path);
      const entry = {
        id,
        url: urlData.publicUrl,
        path,
        title: (title || defaultTitle).trim().slice(0, 80),
        created_at: new Date().toISOString(),
      };

      await persistProfileVideos([...videos, entry]);
      renderShopperVideosManager();
      setVideoUploadStatus("");
      showToast("Video uploaded! Buyers can see it on your profile.");
    } catch (e) {
      console.error("Profile video upload:", e);
      if (uploadedPath) {
        await supabase.storage.from(VIDEO_BUCKET).remove([uploadedPath]);
      }
      const msg = e?.message || "Upload failed.";
      setVideoUploadStatus(msg, true);
      showToast(msg, "error");
    } finally {
      resetVideoUploadUi();
    }
  });
}

window.deleteShopperVideo = async function (videoId) {
  if (!confirm("Remove this video from your profile?")) return;

  const videos = parseProfileVideos(currentProfile.profile_videos);
  const target = videos.find(v => v.id === videoId);
  if (!target) return;

  if (target.path) {
    await supabase.storage.from(VIDEO_BUCKET).remove([target.path]);
  }

  try {
    await persistProfileVideos(videos.filter(v => v.id !== videoId));
    renderShopperVideosManager();
    showToast("Video removed.");
  } catch (e) {
    showToast("Could not remove video: " + e.message, "error");
  }
};

/* Toggle which payout fields show based on method */
window.togglePayoutFields = function(method) {
  const bankFields   = document.getElementById("bankFields");
  const momoFields   = document.getElementById("momoFields");
  const paypalFields = document.getElementById("paypalFields");
  const wiseFields   = document.getElementById("wiseFields");

  [bankFields, momoFields, paypalFields, wiseFields].forEach(el => {
    if (el) el.style.display = "none";
  });

  if (method === "Bank Transfer"  && bankFields)   bankFields.style.display   = "block";
  if (method === "Mobile Money"   && momoFields)   momoFields.style.display   = "block";
  if (method === "PayPal"         && paypalFields) paypalFields.style.display = "block";
  if (method === "Wise / Revolut" && wiseFields)   wiseFields.style.display   = "block";
};

window.toggleNotif = function () {
  document.getElementById("notifToggle")?.classList.toggle("on");
};

window.saveSettings = async function () {
  const fields = {
    name:"settingName", email:"settingEmail", phone:"settingPhone",
    location:"settingLocation", about:"settingAbout", fee:"settingFee",
    response_time:"settingResponseTime", completion_rate:"settingCompletionRate", tags:"settingTags"
  };
  const update = {};
  for (const [key, id] of Object.entries(fields)) update[key] = document.getElementById(id)?.value.trim() || "";
  update.years_active  = parseInt(document.getElementById("settingYearsActive")?.value)||0;
  update.notifications = document.getElementById("notifToggle")?.classList.contains("on") || false;

  const { error } = await supabase.from("users").update(update).eq("uid", currentUser.id);
  if (error) { showToast("Failed to save.", "error"); return; }
  Object.assign(currentProfile, update);
  renderSidebarProfile();
  showToast("Profile saved! ✅");
};

window.savePayoutDetails = async function () {
  const method = document.getElementById("payoutMethod")?.value || "";
  if (!method) { showToast("Please select a payout method.", "error"); return; }

  const update = {
    payout_method:         method,
    payout_account_name:   document.getElementById("payoutAccountName")?.value.trim()   || "",
    payout_account_number: document.getElementById("payoutAccountNumber")?.value.trim() || "",
    payout_bank_name:      document.getElementById("payoutBankName")?.value.trim()      || "",
    payout_country:        document.getElementById("payoutCountry")?.value.trim()       || "",
    payout_email:          document.getElementById("payoutEmail")?.value.trim()         || "",
  };

  const { error } = await supabase.from("users").update(update).eq("uid", currentUser.id);
  if (error) { showToast("Failed to save payout details.", "error"); return; }

  Object.assign(currentProfile, update);
  showToast("💳 Payout details saved! Admin will use these to send your money.", "success");
};

function initAvatarUpload() {
  document.getElementById("settingAvatar")?.addEventListener("change", async function () {
    const file = this.files[0]; if (!file) return;
    const path = `${currentUser.id}/avatar.${file.name.split(".").pop()}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, {upsert:true});
    if (error) { showToast(`Upload failed: ${error.message}`, "error"); return; }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    await supabase.from("users").update({avatar_url:data.publicUrl}).eq("uid",currentUser.id);
    currentProfile.avatar_url = data.publicUrl;
    document.getElementById("avatarPreview").innerHTML =
      `<img src="${data.publicUrl}" style="width:64px;height:64px;border-radius:50%;object-fit:cover">`;
    renderSidebarProfile();
    showToast("Avatar updated!");
  });
}

async function handleShopperInboxMessage(msg) {
  const myId = getShopperChatUserId();
  const partnerUid = getPartnerUidFromMessage(msg, myId);
  const canonicalId = getConvId(myId, partnerUid);

  const fromOther = String(msg.sender_id) !== myId;
  const inOpenThread =
    activeChatPartner &&
    String(activeChatPartner.uid) === partnerUid &&
    document.getElementById("msgThreadMessages")?.style.display !== "none";

  if (fromOther && !inOpenThread) {
    playMessageNotification();
    showToast(`💬 New message from ${msg.sender_name || "Buyer"}`);
    addNotification(`Message from ${msg.sender_name}: "${getPreviewText(msg.content || "")}"`);
  }

  if (
    activeChatPartner &&
    (String(activeChatPartner.uid) === partnerUid || activeChatConvId === canonicalId)
  ) {
    activeChatConvId = canonicalId;
    appendShopperMessageToThread(msg);
    if (String(msg.receiver_id) === myId && !msg.is_read) {
      await markConversationRead(canonicalId, myId, partnerUid);
    }
  }

  scheduleShopperRefreshList();
}

/* ─── CHAT (Supabase) ─── */
async function renderShopperChatList() {
  const list = document.getElementById("msgConvList");
  if (!list) return;

  allShopperConvs = await getConversationSummaries(getShopperChatUserId());

  if (allShopperConvs.length === 0) {
    list.innerHTML = `<div class="msg-conv-empty">No messages yet.<br><br>Buyers will message you from your profile.</div>`;
    updateMsgBadge(0);
    return;
  }

  const unreadMap = await getUnreadMap(getShopperChatUserId());
  const total = Object.values(unreadMap).reduce((a, b) => a + b, 0);
  updateMsgBadge(total);
  renderShopperConvItems(allShopperConvs, unreadMap);
}

function renderShopperConvItems(convs, unreadMap = {}) {
  const list = document.getElementById("msgConvList");
  if (!list) return;
  if (convs.length === 0) {
    list.innerHTML = `<div class="msg-conv-empty">No conversations found.</div>`; return;
  }
  list.innerHTML = convs.map(m => {
    const isMine    = String(m.sender_id) === getShopperChatUserId();
    const partner   = m._partner;
    const otherName = partner?.name || (isMine ? m.receiver_name : m.sender_name);
    const otherId   = partner?.uid  || (isMine ? m.receiver_id   : m.sender_id);
    const preview   = getPreviewText(m.content || "");
    const time      = formatTime(m.created_at);
    const canonicalId = getConvId(getShopperChatUserId(), otherId);
    const unread    = unreadMap[canonicalId] || unreadMap[m.conversation_id] || 0;
    const isActive  = activeChatConvId === canonicalId;
    return `
      <div class="msg-conv-item ${isActive?"active":""}" onclick="openShopperChat('${otherId}','${escapeHtml(otherName)}')">
        <div class="msg-conv-avatar">${(otherName||"?")[0].toUpperCase()}</div>
        <div class="msg-conv-info">
          <div class="msg-conv-name-row">
            <span class="msg-conv-name">${otherName}</span>
            <span class="msg-conv-time">${time}</span>
          </div>
          <div class="msg-conv-bottom">
            <span class="msg-conv-preview">${isMine?"You: ":""}${escapeHtml(preview)}</span>
            ${unread > 0 ? `<span class="msg-unread-badge">${unread}</span>` : ""}
          </div>
        </div>
      </div>`;
  }).join("");
}

function updateMsgBadge(count) {
  const b = document.getElementById("msgBadge");
  if (!b) return;
  b.textContent   = count;
  b.style.display = count > 0 ? "inline-block" : "none";
}

window.openShopperChat = async function (otherUid, otherName) {
  const myId = getShopperChatUserId();
  activeChatConvId  = getConvId(myId, otherUid);
  activeChatPartner = { uid: otherUid, name: otherName, role: "buyer" };
  setConversationPartner(activeChatConvId, activeChatPartner, myId);
  document.getElementById("msgThreadEmpty").style.display    = "none";
  document.getElementById("msgThreadHeader").style.display   = "flex";
  document.getElementById("msgThreadMessages").style.display = "flex";
  document.getElementById("msgThreadInput").style.display    = "flex";
  document.getElementById("msgThreadHav").textContent   = (otherName||"?")[0].toUpperCase();
  document.getElementById("msgThreadHname").textContent = otherName;
  document.querySelector(".messages-section-inner")?.classList.add("thread-open");
  shopperThreadIds = new Set();
  await loadShopperMessages();
  await markShopperRead();
  await renderShopperChatList();
};

window.backToShopperConvList = function () {
  document.querySelector(".messages-section-inner")?.classList.remove("thread-open");
  document.getElementById("msgThreadEmpty").style.display    = "flex";
  document.getElementById("msgThreadHeader").style.display   = "none";
  document.getElementById("msgThreadMessages").style.display = "none";
  document.getElementById("msgThreadInput").style.display    = "none";
  activeChatPartner = null;
  activeChatConvId = null;
  renderShopperChatList();
};

async function loadShopperMessages() {
  if (!activeChatPartner?.uid) return;
  const msgs = await getMessagesForPartner(getShopperChatUserId(), activeChatPartner.uid);
  const container = document.getElementById("msgThreadMessages");
  if (!container) return;
  shopperThreadIds = new Set((msgs || []).map(m => m.id).filter(Boolean));
  if (msgs.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:0.82rem;margin:auto;padding:30px">No messages yet</div>`;
    return;
  }
  let lastDate = null;
  container.innerHTML = msgs.map(m => {
    if (m.content === "[videocall]incoming" || m.content === "[voicecall]incoming") return "";
    const isMine  = String(m.sender_id) === getShopperChatUserId();
    const time    = new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
    const read    = isMine ? (m.is_read?" ✓✓":" ✓") : "";
    const msgDate = new Date(m.created_at).toLocaleDateString();
    let divider   = "";
    if (msgDate !== lastDate) { lastDate = msgDate; divider = `<div class="msg-date-divider">${msgDate}</div>`; }
    return `${divider}
      <div class="message ${isMine?"shopper-message":"buyer-message"}">
        <div>${renderShopperMsgContent(m.content)}</div>
        <div class="msg-time">${time}${read}</div>
      </div>`;
  }).join("");
  container.scrollTop = container.scrollHeight;
}

function appendShopperMessageToThread(m) {
  if (!m?.id || shopperThreadIds.has(m.id)) return;
  if (m.content === "[videocall]incoming" || m.content === "[voicecall]incoming") return;

  const container = document.getElementById("msgThreadMessages");
  if (!container || container.style.display === "none") return;

  shopperThreadIds.add(m.id);
  const empty = container.querySelector("div[style*='padding:30px']");
  if (empty) empty.remove();

  const myId   = getShopperChatUserId();
  const isMine = String(m.sender_id) === myId;
  const time   = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const read   = isMine ? (m.is_read ? " ✓✓" : " ✓") : "";
  const el     = document.createElement("div");
  el.className = `message ${isMine ? "shopper-message" : "buyer-message"}`;
  el.dataset.msgId = m.id;
  el.innerHTML = `<div>${renderShopperMsgContent(m.content)}</div><div class="msg-time">${time}${read}</div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function renderShopperMsgContent(content) {
  if (!content) return "";
  if (content.startsWith("[img]")) {
    const url = content.slice(5);
    return `<img src="${url}" style="max-width:200px;max-height:200px;border-radius:10px;cursor:pointer;display:block" onclick="window.open('${url}','_blank')" loading="lazy">`;
  }
  if (content.startsWith("[audio]")) {
    const url = content.slice(7);
    return `<audio controls style="max-width:190px;height:36px"><source src="${url}"></audio>`;
  }
  return escapeHtml(content);
}

function appendShopperOptimistic(content) {
  const container = document.getElementById("msgThreadMessages");
  if (!container) return;
  const empty = container.querySelector("div[style*='padding:30px']");
  if (empty) empty.remove();
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const el   = document.createElement("div");
  el.className = "message shopper-message";
  el.innerHTML = `<div>${renderShopperMsgContent(content)}</div><div class="msg-time">${time} ✓</div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

window.sendShopperMessage = async function () {
  const input   = document.getElementById("shopperChatInput");
  const content = input?.value.trim();
  if (!content || !activeChatConvId || !activeChatPartner) return;
  input.value = "";
  const msg = buildMessage({
    conversation_id: activeChatConvId,
    sender_id:       getShopperChatUserId(),
    sender_name:     currentProfile.name,
    sender_role:     "shopper",
    receiver_id:     activeChatPartner.uid,
    receiver_name:   activeChatPartner.name,
    content,
  });
  try {
    const saved = await sendChatMessage(supabase, msg);
    appendShopperMessageToThread(saved);
    scheduleShopperRefreshList();
  } catch (e) {
    console.error("Send error:", e);
    showToast("Failed to send.", "error");
  }
};

window.triggerShopperImageUpload = function () { document.getElementById("shopperImageInput")?.click(); };

window.handleShopperImageUpload = async function (e) {
  const file = e.target.files?.[0];
  if (!file || !activeChatConvId || !activeChatPartner) return;
  e.target.value = "";
  try {
    const blob = await compressImageToBlob(file);
    appendShopperOptimistic("[img]" + URL.createObjectURL(blob));
    const url = await uploadChatBlob(blob, {
      userId: getShopperChatUserId(),
      convId: activeChatConvId,
      ext: "jpg",
    });
    const msg = buildMessage({
      conversation_id: activeChatConvId,
      sender_id: getShopperChatUserId(),
      sender_name: currentProfile.name,
      sender_role: "shopper",
      receiver_id: activeChatPartner.uid,
      receiver_name: activeChatPartner.name,
      content: "[img]" + url,
    });
    await sendChatMessage(supabase, msg);
    await loadShopperMessages();
    scheduleShopperRefreshList();
  } catch (err) {
    showToast(err.message || "Failed to send image.", "error");
  }
};

window.toggleShopperVoice = async function () {
  if (shopperIsRecording) {
    shopperMediaRecorder?.stop();
    shopperIsRecording = false;
    const btn = document.getElementById("shopperVoiceBtn");
    if (btn) { btn.style.background = ""; btn.style.color = ""; btn.title = "Record voice note"; }
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      shopperAudioChunks   = [];
      shopperMediaRecorder = new MediaRecorder(stream);
      shopperMediaRecorder.ondataavailable = e => shopperAudioChunks.push(e.data);
      shopperMediaRecorder.onstop = async () => {
        const blob = new Blob(shopperAudioChunks, { type: "audio/webm" });
        stream.getTracks().forEach(t => t.stop());
        await uploadShopperAudio(blob);
      };
      shopperMediaRecorder.start();
      shopperIsRecording = true;
      const btn = document.getElementById("shopperVoiceBtn");
      if (btn) { btn.style.background = "#e74c3c"; btn.style.color = "#fff"; btn.title = "Click to stop recording"; }
    } catch { alert("Microphone access denied."); }
  }
};

async function uploadShopperAudio(blob) {
  if (!activeChatConvId || !activeChatPartner) return;
  appendShopperOptimistic("[audio]…");
  try {
    const url = await uploadChatBlob(blob, {
      userId: getShopperChatUserId(),
      convId: activeChatConvId,
      ext: "webm",
    });
    const msg = buildMessage({
      conversation_id: activeChatConvId,
      sender_id: getShopperChatUserId(),
      sender_name: currentProfile.name,
      sender_role: "shopper",
      receiver_id: activeChatPartner.uid,
      receiver_name: activeChatPartner.name,
      content: "[audio]" + url,
    });
    await sendChatMessage(supabase, msg);
    await loadShopperMessages();
    scheduleShopperRefreshList();
  } catch (e) {
    showToast(e.message || "Failed to send voice note.", "error");
  }
}

/* ─── CALLS ─── */
window.startShopperVideoCall = async function () {
  if (!activeChatPartner) return;
  await startShopperCall("video");
};
window.startShopperVoiceCall = async function () {
  if (!activeChatPartner) return;
  await startShopperCall("voice");
};
window.acceptShopperVideoCall = async function () {
  hideIncomingCallScreen();
  await acceptShopperCall("video");
};
window.acceptShopperVoiceCall = async function () {
  hideIncomingCallScreen();
  await acceptShopperCall("voice");
};
window.rejectShopperCall = async function () {
  hideIncomingCallScreen();
  stopAllCallSounds();
  if (shopperActiveCall) {
    try { await shopperActiveCall.rejectRemote?.(); } catch {}
    shopperActiveCall.end();
    shopperActiveCall = null;
  } else {
    await rejectIncomingCall();
  }
};
window.endShopperCall = function (playEndTone = true) {
  stopAllCallSounds();
  shopperActiveCall?.end(playEndTone);
  shopperActiveCall = null;
  clearIncomingCallPrep();
  hideIncomingCallScreen();
};

async function startShopperCall(callType) {
  window.endShopperCall(false);
  try {
    await sendCallInvite(supabase, {
      sender_id: getShopperChatUserId(),
      sender_name: currentProfile.name,
      sender_role: "shopper",
      receiver_id: activeChatPartner.uid,
      receiver_name: activeChatPartner.name,
      callType,
      conversation_id: activeChatConvId,
    });
    playOutgoingRingback();
    await new Promise(r => setTimeout(r, 400));
    shopperActiveCall = await startOutgoingCall({
      supabase,
      myUserId: getShopperChatUserId(),
      partnerUserId: activeChatPartner.uid,
      partnerName: activeChatPartner.name,
      callType,
    });
  } catch (e) {
    showToast(e.message || "Could not start call.", "error");
    window.endShopperCall();
  }
}

async function acceptShopperCall(callType) {
  stopIncomingCallRing();
  stopOutgoingRingback();
  if (shopperActiveCall) {
    shopperActiveCall.end(false);
    shopperActiveCall = null;
  }
  try {
    shopperActiveCall = await acceptIncomingCall({
      supabase,
      myUserId: getShopperChatUserId(),
      partnerUserId: activeChatPartner.uid,
      partnerName: activeChatPartner.name,
      callType,
    });
  } catch (e) {
    showToast(e.message || "Could not connect call.", "error");
    window.endShopperCall();
  }
}


async function handleShopperIncomingCall(payload) {
  const myId = getShopperChatUserId();
  if (payload.receiver_id && String(payload.receiver_id) !== myId) return;

  const callType = payload.callType === "voice" ? "voice" : "video";
  const isVideo = callType === "video";
  const senderId = String(payload.sender_id);

  if (!activeChatPartner || String(activeChatPartner.uid) !== senderId) {
    activeChatPartner = { uid: senderId, name: payload.sender_name || "User", role: "buyer" };
    activeChatConvId = getConvId(myId, senderId);
    setConversationPartner(activeChatConvId, activeChatPartner, myId);
  }

  showToast(`📞 Incoming ${isVideo ? "video" : "voice"} call from ${payload.sender_name || "Buyer"}`);

  await prepareIncomingCallSignaling(supabase, myId, senderId, callType);

  playIncomingCallRing();

  showIncomingCallScreen({
    partnerName: payload.sender_name || "Buyer",
    callType,
    onAccept: () => (isVideo ? acceptShopperVideoCall() : acceptShopperVoiceCall()),
    onDecline: () => rejectShopperCall(),
  });
}

async function markShopperRead() {
  if (!activeChatConvId || !activeChatPartner?.uid) return;
  await markConversationRead(activeChatConvId, getShopperChatUserId(), activeChatPartner.uid);
}

window.filterShopperConversations = function (query) {
  if (!query) { renderShopperConvItems(allShopperConvs); return; }
  const q = query.toLowerCase();
  const filtered = allShopperConvs.filter(m => {
    const isMine = String(m.sender_id) === getShopperChatUserId();
    const partner = m._partner;
    const otherName = partner?.name || (isMine ? m.receiver_name : m.sender_name);
    return (otherName || "").toLowerCase().includes(q) || (m.content || "").toLowerCase().includes(q);
  });
  renderShopperConvItems(filtered);
};

/* ─── NOTIFICATIONS ─── */
function getNotifications() { return JSON.parse(localStorage.getItem("bfm_notifications")) || []; }
function addNotification(msg) {
  const n = getNotifications();
  n.unshift({message:msg, time:Date.now()});
  localStorage.setItem("bfm_notifications", JSON.stringify(n));
  updateNotifDot();
}
function updateNotifDot() {
  const dot = document.getElementById("notifDot");
  if (dot) dot.className = getNotifications().length > 0 ? "notif-dot show" : "notif-dot";
}
window.openNotifications = function () {
  const n = getNotifications();
  if (n.length === 0) { showToast("No new notifications."); return; }
  alert("Notifications:\n\n" + n.map(x => `• ${x.message}`).join("\n"));
  localStorage.removeItem("bfm_notifications");
  updateNotifDot();
};

/* ─── LOGOUT ─── */
window.handleLogout = async function () {
  await supabase.auth.signOut();
  window.location.href = "auth.html";
};